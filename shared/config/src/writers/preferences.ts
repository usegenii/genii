/**
 * Write preferences configuration.
 * @module config/writers/preferences
 */

import { join } from 'node:path';
import { readTomlFileOptional } from '../loaders/toml.js';
import { writeTomlFile } from './toml.js';

/**
 * Preferences configuration for writing.
 */
export interface PreferencesConfigWrite {
	logLevel?: 'debug' | 'info' | 'warn' | 'error';
	shellTimeout?: number;
	timezone?: string;
}

/**
 * Save preferences configuration.
 * Merges with existing preferences if they exist.
 *
 * @param basePath - Base config directory path
 * @param preferences - Preferences to save
 */
export async function savePreferencesConfig(basePath: string, preferences: PreferencesConfigWrite): Promise<void> {
	const filePath = join(basePath, 'preferences.toml');

	// Load existing preferences if they exist
	const existing = await readTomlFileOptional<PreferencesConfigWrite>(filePath);

	// Merge with new values
	const merged = {
		...existing,
		...preferences,
	};

	await writeTomlFile(filePath, merged);
}
