import path from 'node:path';
import type { PreferencesConfig } from '../types/preferences.js';
import { readTomlFileOptional } from './toml.js';

const PREFERENCES_FILENAME = 'preferences.toml';

const DEFAULT_PREFERENCES: PreferencesConfig = {
	agents: {
		defaultModels: [],
		tools: {
			shell: {
				defaultWorkingDir: undefined,
				defaultTimeout: 30_000,
				maxOutputLength: 50_000,
			},
		},
	},
	logging: {
		level: 'info',
	},
	timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

/**
 * Deep merge two objects, with source values taking precedence.
 * Handles nested objects recursively.
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
	const result = { ...target };

	for (const key of Object.keys(source) as (keyof T)[]) {
		const sourceValue = source[key];
		const targetValue = target[key];

		if (
			sourceValue !== undefined &&
			typeof sourceValue === 'object' &&
			sourceValue !== null &&
			!Array.isArray(sourceValue) &&
			typeof targetValue === 'object' &&
			targetValue !== null &&
			!Array.isArray(targetValue)
		) {
			// Both are objects, merge recursively
			result[key] = deepMerge(
				targetValue as Record<string, unknown>,
				sourceValue as Record<string, unknown>,
			) as T[keyof T];
		} else if (sourceValue !== undefined) {
			// Use source value if defined
			result[key] = sourceValue as T[keyof T];
		}
	}

	return result;
}

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
	const config = await readTomlFileOptional<Partial<PreferencesConfig>>(filePath);

	if (!config) {
		return DEFAULT_PREFERENCES;
	}

	return deepMerge(DEFAULT_PREFERENCES, config);
}
