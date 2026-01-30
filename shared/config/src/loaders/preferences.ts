import path from 'node:path';
import type { PreferencesConfig } from '../types/preferences.js';
import { readTomlFileOptional } from './toml.js';

const PREFERENCES_FILENAME = 'preferences.toml';

const DEFAULT_PREFERENCES: PreferencesConfig = {
	agents: {
		defaultModels: [],
	},
	logging: {
		level: 'info',
	},
};

/**
 * Load preferences configuration from a TOML file.
 *
 * @param basePath - The base directory containing the preferences.toml file
 * @returns The preferences configuration, or defaults if the file doesn't exist
 *
 * @example
 * const preferences = await loadPreferencesConfig('./config');
 * console.log(preferences.agents.defaultModels);
 * console.log(preferences.logging.level);
 */
export async function loadPreferencesConfig(basePath: string): Promise<PreferencesConfig> {
	const filePath = path.join(basePath, PREFERENCES_FILENAME);
	const config = await readTomlFileOptional<PreferencesConfig>(filePath);

	if (!config) {
		return DEFAULT_PREFERENCES;
	}

	return config;
}
