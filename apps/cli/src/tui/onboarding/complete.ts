/**
 * Onboarding completion handler.
 * Writes all config files and stores secrets when wizard finishes.
 * @module tui/onboarding/complete
 */

import { join } from 'node:path';
import { readTomlFileOptional } from '@genii/config/loaders/toml';
import { CUSTOM_PROVIDER_DEFINITION, getProvider } from '@genii/config/providers/definitions';
import { createSecretStore } from '@genii/config/secrets/composite';
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

	// 4. Write preferences.toml (defaultModels only written if none exist)
	await savePreferencesConfig(configPath, {
		logLevel: state.preferences.logLevel,
		shellTimeout: state.preferences.shellTimeout,
		timezone: state.preferences.timezone,
		defaultModels: state.selectedModels,
	});

	// 5. Write pulse/scheduler config if enabled
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

	// 6. Copy templates via daemon
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
