/**
 * Write preferences configuration.
 * @module config/writers/preferences
 */

import { join } from 'node:path';
import { readTomlFileOptional } from '../loaders/toml.js';
import type { PreferencesConfig } from '../types/preferences.js';
import { writeTomlFile } from './toml.js';

/**
 * Preferences configuration for writing.
 * Uses flat properties that get transformed to the nested TOML structure.
 */
export interface PreferencesConfigWrite {
	logLevel?: 'debug' | 'info' | 'warn' | 'error';
	shellTimeout?: number;
	timezone?: string;
	defaultModels?: string[];
}

/**
 * Save preferences configuration.
 * Merges with existing preferences if they exist.
 * Transforms flat properties to the nested structure expected by preferences.toml.
 *
 * @param basePath - Base config directory path
 * @param preferences - Preferences to save
 */
export async function savePreferencesConfig(basePath: string, preferences: PreferencesConfigWrite): Promise<void> {
	const filePath = join(basePath, 'preferences.toml');

	// Load existing preferences if they exist
	const existing = await readTomlFileOptional<Partial<PreferencesConfig>>(filePath);

	// Build the nested structure from flat properties
	const result: Partial<PreferencesConfig> = { ...existing };

	// Handle logging.level
	if (preferences.logLevel !== undefined) {
		result.logging = {
			...(result.logging ?? { level: 'info' }),
			level: preferences.logLevel,
		};
	}

	// Handle timezone (top-level)
	if (preferences.timezone !== undefined) {
		result.timezone = preferences.timezone;
	}

	// Handle agents structure
	if (preferences.shellTimeout !== undefined || preferences.defaultModels !== undefined) {
		const existingAgents = result.agents ?? { defaultModels: [] };
		result.agents = { ...existingAgents };

		// Handle agents.defaultModels - only set if not already present
		if (preferences.defaultModels !== undefined) {
			const existingDefaultModels = existingAgents.defaultModels;
			if (!existingDefaultModels || existingDefaultModels.length === 0) {
				result.agents.defaultModels = preferences.defaultModels;
			}
		}

		// Handle agents.tools.shell.defaultTimeout
		if (preferences.shellTimeout !== undefined) {
			const existingTools = existingAgents.tools ?? {};
			const existingShell = existingTools.shell ?? {};
			result.agents.tools = {
				...existingTools,
				shell: {
					...existingShell,
					defaultTimeout: preferences.shellTimeout,
				},
			};
		}
	}

	await writeTomlFile(filePath, result);
}
