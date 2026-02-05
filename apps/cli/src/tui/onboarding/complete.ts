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

	// Get provider details
	const isCustomProvider = state.provider.type === 'custom';
	const providerId = isCustomProvider ? 'custom' : (state.provider.builtinId ?? 'zai');
	const providerDef = isCustomProvider ? CUSTOM_PROVIDER_DEFINITION : getProvider(providerId);

	if (!providerDef) {
		return { success: false, error: `Unknown provider: ${providerId}` };
	}

	// Get API key and base URL based on provider type
	const apiKey = isCustomProvider ? state.provider.custom?.apiKey : state.provider.apiKey;
	const baseUrl = isCustomProvider ? state.provider.custom?.baseUrl : providerDef.defaultBaseUrl;
	const apiType = isCustomProvider ? (state.provider.custom?.apiType ?? 'anthropic') : providerDef.apiType;

	// Check if we should keep the existing API key
	const keepExistingApiKey = state.provider.keepExistingApiKey ?? false;

	if (!keepExistingApiKey && !apiKey) {
		return { success: false, error: 'API key is required' };
	}

	if (!baseUrl) {
		return { success: false, error: 'Base URL is required' };
	}

	// 1. Store API key in OS keychain / secret store (skip if keeping existing)
	const secretStore = await createSecretStore(configPath, 'genii');
	const secretName = `${providerId}-api-key`;

	if (!keepExistingApiKey && apiKey) {
		const secretResult = await secretStore.set(secretName, apiKey);

		if (!secretResult.success) {
			return { success: false, error: `Failed to store API key: ${secretResult.error}` };
		}
	}

	// 2. Write providers.toml
	await saveProvidersConfig(configPath, {
		[providerId]: {
			type: apiType,
			baseUrl,
			credential: `secret:${secretName}`,
		},
	});

	// 3. Write models.toml (and remove deselected models)
	const modelsPath = join(configPath, 'models.toml');
	const existingModels = await readTomlFileOptional<Record<string, ModelConfigWrite>>(modelsPath);

	// Start with existing models, removing ones marked for removal
	const modelsConfig: Record<string, ModelConfigWrite> = { ...existingModels };
	for (const modelId of state.modelsToRemove ?? []) {
		delete modelsConfig[modelId];
	}

	// Add/update selected models
	for (const modelId of state.selectedModels) {
		modelsConfig[modelId] = {
			provider: providerId,
			modelId,
		};
	}

	// Write the full config (not using merge since we've already handled it)
	await writeTomlFile(modelsPath, modelsConfig);

	// 4. Write channels.toml and store channel credentials
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

	// 5. Write preferences.toml (defaultModels only written if none exist)
	await savePreferencesConfig(configPath, {
		logLevel: state.preferences.logLevel,
		shellTimeout: state.preferences.shellTimeout,
		timezone: state.preferences.timezone,
		defaultModels: state.selectedModels,
	});

	// 6. Write pulse/scheduler config if enabled
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

	// 7. Copy templates via daemon
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
