import path from 'node:path';
import type { ModelConfig } from '../types/model.js';
import { readTomlFileOptional } from './toml.js';

/**
 * Load model configurations from a models.toml file.
 *
 * The TOML file format uses section names as model identifiers:
 * ```toml
 * [claude-opus]
 * provider = "anthropic"
 * model-id = "claude-opus-4-5-20251101"
 * ```
 *
 * @param basePath - The directory containing the models.toml file
 * @returns A record mapping model names to their configurations, or empty object if file doesn't exist
 *
 * @example
 * const models = await loadModelsConfig('./config');
 * // { 'claude-opus': { provider: 'anthropic', modelId: 'claude-opus-4-5-20251101' } }
 */
export async function loadModelsConfig(basePath: string): Promise<Record<string, ModelConfig>> {
	const filePath = path.join(basePath, 'models.toml');
	const config = await readTomlFileOptional<Record<string, ModelConfig>>(filePath);
	return config ?? {};
}
