/**
 * Loader for existing configuration files.
 * @module tui/onboarding/existing-config-loader
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadChannelsConfig } from '@genii/config/loaders/channels';
import { loadModelsConfig } from '@genii/config/loaders/models';
import { loadProvidersConfig } from '@genii/config/loaders/providers';
import { BUILTIN_PROVIDERS } from '@genii/config/providers/definitions';
import { createSecretStore } from '@genii/config/secrets/composite';
import type { ExistingChannelInfo, ExistingConfig, ExistingModelInfo, ExistingProviderInfo } from './types';

/**
 * Extract secret name from a credential reference.
 * Returns undefined if not a secret reference.
 */
function getSecretName(credential: string): string | undefined {
	if (credential.startsWith('secret:')) {
		return credential.slice(7);
	}
	return undefined;
}

/**
 * Load existing configuration from config files.
 *
 * @param configPath - Base path for config files
 * @returns Existing configuration with providers and models
 */
export async function loadExistingConfig(configPath: string): Promise<ExistingConfig> {
	const builtinIds = new Set(BUILTIN_PROVIDERS.map((p) => p.id));

	// Load provider and model configs
	const providersConfig = await loadProvidersConfig(configPath);
	const modelsConfig = await loadModelsConfig(configPath);

	// Create secret store to check for stored API keys
	const secretStore = await createSecretStore(configPath, 'genii');

	// Build provider info with API key status
	const providers: ExistingProviderInfo[] = [];
	for (const [providerId, config] of Object.entries(providersConfig)) {
		const secretName = getSecretName(config.credential);
		let hasStoredApiKey = false;

		if (secretName) {
			const result = await secretStore.get(secretName);
			hasStoredApiKey = result.success;
		}

		providers.push({
			providerId,
			config,
			isBuiltin: builtinIds.has(providerId),
			hasStoredApiKey,
		});
	}

	// Build model info
	const models: ExistingModelInfo[] = Object.entries(modelsConfig).map(([modelId, config]) => ({
		modelId,
		config,
		providerId: config.provider,
	}));

	// Build channel info with credential status
	const channelsResult = await loadChannelsConfig(configPath);
	const channels: ExistingChannelInfo[] = [];
	for (const [channelName, config] of Object.entries(channelsResult.channels)) {
		const secretName = getSecretName(config.credential);
		let hasStoredCredential = false;

		if (secretName) {
			const result = await secretStore.get(secretName);
			hasStoredCredential = result.success;
		}

		channels.push({
			name: channelName,
			config,
			hasStoredCredential,
		});
	}

	// Check if preferences.toml exists (indicates user has completed onboarding before)
	let hasExistingPreferences = false;
	try {
		await access(join(configPath, 'preferences.toml'));
		hasExistingPreferences = true;
	} catch {
		// File doesn't exist
	}

	return { providers, models, channels, hasExistingPreferences };
}

/**
 * Get existing models for a specific provider.
 *
 * @param existingConfig - The loaded existing configuration
 * @param providerId - The provider ID to filter by
 * @returns Array of model info for the provider
 */
export function getExistingModelsForProvider(
	existingConfig: ExistingConfig | undefined,
	providerId: string,
): ExistingModelInfo[] {
	if (!existingConfig) {
		return [];
	}
	return existingConfig.models.filter((m) => m.providerId === providerId);
}
