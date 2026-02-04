/**
 * Write providers configuration.
 * @module config/writers/providers
 */

import { join } from 'node:path';
import { writeTomlFile } from './toml.js';

/**
 * Provider configuration for writing.
 */
export interface ProviderConfigWrite {
	type: 'anthropic' | 'openai';
	baseUrl: string;
	credential: string; // Format: "secret:provider-api-key"
}

/**
 * Save providers configuration.
 *
 * @param basePath - Base config directory path
 * @param providers - Provider configs keyed by name
 *
 * @example
 * await saveProvidersConfig('/home/user/.config/geniigotchi', {
 *   zai: {
 *     type: 'anthropic',
 *     baseUrl: 'https://api.zai.com',
 *     credential: 'secret:zai-api-key',
 *   },
 * });
 */
export async function saveProvidersConfig(
	basePath: string,
	providers: Record<string, ProviderConfigWrite>,
): Promise<void> {
	const filePath = join(basePath, 'providers.toml');
	await writeTomlFile(filePath, providers);
}
