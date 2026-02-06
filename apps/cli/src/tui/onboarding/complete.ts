/**
 * Onboarding completion handler.
 * Writes all config files and stores secrets when wizard finishes.
 * @module tui/onboarding/complete
 */

import { join } from 'node:path';
import { readTomlFileOptional } from '@genii/config/loaders/toml';
import { CUSTOM_PROVIDER_DEFINITION, getProvider } from '@genii/config/providers/definitions';
import { createSecretStore } from '@genii/config/secrets/composite';
import { saveChannelsConfig } from '@genii/config/writers/channels';
import type { ModelConfigWrite } from '@genii/config/writers/models';
import { savePreferencesConfig } from '@genii/config/writers/preferences';
import { saveProvidersConfig } from '@genii/config/writers/providers';
import { writeTomlFile } from '@genii/config/writers/toml';
import { createDaemonClient } from '../../client';
import type { OnboardingState } from './types';

/**
 * Result of completing the onboarding wizard.
 */
export interface CompleteResult {
	success: boolean;
	error?: string;
	templatesCopied?: string[];
	templatesBackedUp?: string[];
}

/**
 * Convert interval shorthand to cron expression.
 */
function intervalToCron(interval: string): string {
	switch (interval) {
		case '15m':
			return '*/15 * * * *';
		case '30m':
			return '*/30 * * * *';
		case '1h':
			return '0 * * * *';
		case '2h':
			return '0 */2 * * *';
		case '4h':
			return '0 */4 * * *';
		case '6h':
			return '0 */6 * * *';
		default:
			return '0 * * * *';
	}
}

/**
 * Complete the onboarding wizard by writing all configs and storing secrets.
 *
 * @param state - The final wizard state
 * @param guidancePath - Path to the guidance directory (from daemon status)
 * @returns Result indicating success or failure
 */
export async function completeOnboarding(state: OnboardingState, guidancePath: string): Promise<CompleteResult> {
	// Derive config path from guidance path (remove /guidance suffix)
	const configPath = guidancePath.replace(/\/guidance$/, '');

	// 1. Create secret store
	const secretStore = await createSecretStore(configPath, 'genii');

	// 2. Process all providers (skip those marked for removal)
	const providerConfigs: Record<string, { type: 'anthropic' | 'openai'; baseUrl: string; credential: string }> = {};
	const allSelectedModels: string[] = [];
	const modelsConfig: Record<string, ModelConfigWrite> = {};

	for (const provider of state.providers) {
		if (state.providersToRemove.includes(provider.id)) continue;

		const isCustomProvider = provider.type === 'custom';
		const providerId = isCustomProvider ? provider.id : (provider.builtinId ?? provider.id);
		const providerDef = isCustomProvider ? CUSTOM_PROVIDER_DEFINITION : getProvider(providerId);

		if (!providerDef) {
			return { success: false, error: `Unknown provider: ${providerId}` };
		}

		const apiKey = isCustomProvider ? provider.custom?.apiKey : provider.apiKey;
		const baseUrl = isCustomProvider ? provider.custom?.baseUrl : providerDef.defaultBaseUrl;
		const apiType = isCustomProvider ? (provider.custom?.apiType ?? 'anthropic') : providerDef.apiType;
		const keepExistingApiKey = provider.keepExistingApiKey ?? false;

		if (!keepExistingApiKey && !apiKey) {
			return { success: false, error: `API key is required for provider ${providerId}` };
		}

		if (!baseUrl) {
			return { success: false, error: `Base URL is required for provider ${providerId}` };
		}

		// Store API key in OS keychain / secret store (skip if keeping existing)
		const secretName = `${providerId}-api-key`;

		if (!keepExistingApiKey && apiKey) {
			const secretResult = await secretStore.set(secretName, apiKey);
			if (!secretResult.success) {
				return { success: false, error: `Failed to store API key for ${providerId}: ${secretResult.error}` };
			}
		}

		// Build provider config entry
		providerConfigs[providerId] = {
			type: apiType,
			baseUrl,
			credential: `secret:${secretName}`,
		};

		// Collect models for this provider
		for (const modelId of provider.selectedModels) {
			modelsConfig[modelId] = {
				provider: providerId,
				modelId,
			};
			allSelectedModels.push(modelId);
		}
	}

	// 3. Write providers.toml (with removal support)
	await saveProvidersConfig(configPath, providerConfigs, state.providersToRemove);

	// 4. Write models.toml
	const modelsPath = join(configPath, 'models.toml');
	const existingModels = await readTomlFileOptional<Record<string, ModelConfigWrite>>(modelsPath);

	// Start with existing models
	const finalModelsConfig: Record<string, ModelConfigWrite> = { ...existingModels };

	// Remove models belonging to removed providers
	if (state.providersToRemove.length > 0) {
		for (const [modelId, modelConfig] of Object.entries(finalModelsConfig)) {
			if (state.providersToRemove.includes(modelConfig.provider)) {
				delete finalModelsConfig[modelId];
			}
		}
	}

	// Remove existing models that were deselected (for active providers)
	for (const provider of state.providers) {
		if (state.providersToRemove.includes(provider.id)) continue;
		const providerId = provider.type === 'custom' ? provider.id : (provider.builtinId ?? provider.id);

		// Find existing models for this provider that are no longer selected
		for (const [modelId, modelConfig] of Object.entries(finalModelsConfig)) {
			if (modelConfig.provider === providerId && !provider.selectedModels.includes(modelId)) {
				delete finalModelsConfig[modelId];
			}
		}
	}

	// Add/update selected models across all active providers
	Object.assign(finalModelsConfig, modelsConfig);

	// Write the full config
	await writeTomlFile(modelsPath, finalModelsConfig);

	// 5. Write channels.toml and store channel credentials
	if (state.channels.length > 0) {
		const channelConfigs: Record<string, { type: string; credential: string; [key: string]: unknown }> = {};

		for (const channel of state.channels) {
			// Skip channels marked for removal
			if (state.channelsToRemove.includes(channel.name)) continue;

			const credentialSecretName = `${channel.name}-credential`;

			// Store credential if not keeping existing
			if (!channel.keepExistingCredential && channel.credential) {
				const credResult = await secretStore.set(credentialSecretName, channel.credential);
				if (!credResult.success) {
					return {
						success: false,
						error: `Failed to store credential for channel ${channel.name}: ${credResult.error}`,
					};
				}
			}

			// Build channel config with type-specific field transformation
			const config: Record<string, unknown> = {
				type: channel.type,
				credential: `secret:${credentialSecretName}`,
			};

			if (channel.type === 'telegram') {
				// Transform comma-separated user IDs to string array
				const userIds = channel.fieldValues.allowedUserIds;
				config.allowedUserIds = userIds
					? userIds
							.split(',')
							.map((id) => id.trim())
							.filter(Boolean)
					: [];
				// Parse polling interval
				config.pollingIntervalMs = Number.parseInt(channel.fieldValues.pollingIntervalMs ?? '1000', 10);
			} else {
				// Generic: pass field values as-is
				for (const [key, value] of Object.entries(channel.fieldValues)) {
					config[key] = value;
				}
			}

			channelConfigs[channel.name] = config as { type: string; credential: string; [key: string]: unknown };
		}

		await saveChannelsConfig(configPath, channelConfigs, state.channelsToRemove);
	}

	// 6. Write preferences.toml (defaultModels only written if none exist)
	await savePreferencesConfig(configPath, {
		logLevel: state.preferences.logLevel,
		shellTimeout: state.preferences.shellTimeout,
		timezone: state.preferences.timezone,
		defaultModels: allSelectedModels,
	});

	// 7. Write pulse/scheduler config if enabled
	if (state.pulse.enabled) {
		const pulseSchedule = intervalToCron(state.pulse.interval);
		const prefsPath = join(configPath, 'preferences.toml');
		const existingPrefs = await readTomlFileOptional<Record<string, unknown>>(prefsPath);

		const schedulerConfig = {
			...existingPrefs,
			scheduler: {
				enabled: true,
				pulse: {
					schedule: pulseSchedule,
				},
			},
		};

		await writeTomlFile(prefsPath, schedulerConfig);
	}

	// 8. Copy templates via daemon
	let templatesCopied: string[] = [];
	let templatesBackedUp: string[] = [];

	try {
		const client = createDaemonClient();
		await client.connect();

		const result = await client.onboardExecute({
			backup: state.templates.overwriteMode === 'backup',
			skip: state.templates.overwriteMode === 'skip',
			dryRun: false,
		});

		templatesCopied = result.copied;
		templatesBackedUp = result.backedUp;

		await client.disconnect();
	} catch (error) {
		// Template copy failure is not fatal - configs are already saved
		console.error('Warning: Failed to copy templates:', error);
	}

	return {
		success: true,
		templatesCopied,
		templatesBackedUp,
	};
}
