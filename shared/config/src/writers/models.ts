/**
 * Write models configuration.
 * @module config/writers/models
 */

import { join } from 'node:path';
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
 *
 * @param basePath - Base config directory path
 * @param models - Model configs keyed by name
 *
 * @example
 * await saveModelsConfig('/home/user/.config/geniigotchi', {
 *   'claude-opus': {
 *     provider: 'zai',
 *     modelId: 'claude-opus-4-20250514',
 *     thinkingLevel: 'medium',
 *   },
 * });
 */
export async function saveModelsConfig(basePath: string, models: Record<string, ModelConfigWrite>): Promise<void> {
	const filePath = join(basePath, 'models.toml');
	await writeTomlFile(filePath, models);
}
