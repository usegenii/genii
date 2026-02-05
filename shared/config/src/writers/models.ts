/**
 * Write models configuration.
 * @module config/writers/models
 */

import { join } from 'node:path';
import { readTomlFileOptional } from '../loaders/toml.js';
import { writeTomlFile } from './toml.js';

/**
 * Model configuration for writing.
 */
export interface ModelConfigWrite {
	provider: string;
	modelId: string;
	thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
}

/**
 * Save models configuration.
 * Merges with existing models if they exist.
 *
 * @param basePath - Base config directory path
 * @param models - Model configs keyed by name
 *
 * @example
 * await saveModelsConfig('/home/user/.config/genii', {
 *   'claude-opus': {
 *     provider: 'zai',
 *     modelId: 'claude-opus-4-20250514',
 *     thinkingLevel: 'medium',
 *   },
 * });
 */
export async function saveModelsConfig(basePath: string, models: Record<string, ModelConfigWrite>): Promise<void> {
	const filePath = join(basePath, 'models.toml');

	// Load existing models if they exist
	const existing = await readTomlFileOptional<Record<string, ModelConfigWrite>>(filePath);

	// Merge new models with existing (new models take precedence for same key)
	const merged = {
		...existing,
		...models,
	};

	await writeTomlFile(filePath, merged);
}
