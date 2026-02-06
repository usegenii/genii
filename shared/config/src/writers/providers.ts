/**
 * Write providers configuration.
 * @module config/writers/providers
 */

import { join } from 'node:path';
import { readTomlFileOptional } from '../loaders/toml.js';
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
 * Merges with existing providers if they exist.
 *
 * @param basePath - Base config directory path
 * @param providers - Provider configs keyed by name
 *
 * @example
 * await saveProvidersConfig('/home/user/.config/genii', {
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
	providersToRemove?: string[],
): Promise<void> {
	const filePath = join(basePath, 'providers.toml');

	// Load existing providers if they exist
	const existing = await readTomlFileOptional<Record<string, ProviderConfigWrite>>(filePath);

	// Start with existing data
	const merged: Record<string, unknown> = { ...existing };

	// Remove providers marked for deletion
	if (providersToRemove) {
		for (const name of providersToRemove) {
			delete merged[name];
		}
	}

	// Merge new providers (new take precedence for same key)
	for (const [key, value] of Object.entries(providers)) {
		merged[key] = value;
	}

	await writeTomlFile(filePath, merged);
}
