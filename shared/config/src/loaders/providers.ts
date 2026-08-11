import path from 'node:path';
import { isProviderApiType, PROVIDER_API_TYPES, type ProviderConfig } from '../types/provider.js';
import { readTomlTableMapOptional } from './toml.js';

/**
 * Load provider configurations from a providers.toml file.
 *
 * @param basePath - The directory containing providers.toml
 * @returns A record of provider name to configuration, or empty object if file doesn't exist
 *
 * @example
 * // providers.toml format:
 * // [anthropic]
 * // type = "anthropic"
 * // base-url = "https://api.anthropic.com"
 * // credential = "secret:anthropic-api-key"
 *
 * const providers = await loadProvidersConfig('./config');
 * // Returns: { anthropic: { type: 'anthropic', baseUrl: '...', credential: '...' } }
 */
export async function loadProvidersConfig(basePath: string): Promise<Record<string, ProviderConfig>> {
	const filePath = path.join(basePath, 'providers.toml');
	const config = await readTomlTableMapOptional<ProviderConfig>(filePath);
	if (!config) return {};

	for (const [providerId, provider] of Object.entries(config)) {
		if (!isProviderApiType(provider.type)) {
			throw new Error(
				`Provider "${providerId}" has unsupported API type "${String(provider.type)}". Supported types: ${PROVIDER_API_TYPES.join(', ')}`,
			);
		}
	}

	return config;
}
