/**
 * Model resolution utilities.
 *
 * Provides functions to resolve default models from configuration.
 */

import type { Config } from '@genii/config/config';

/**
 * Resolve the default model from configuration.
 *
 * Returns the first model from `preferences.agents.defaultModels`.
 *
 * @param config - The loaded configuration
 * @returns The default model identifier in format "provider/model-name"
 * @throws Error if no default models are configured
 */
export function resolveDefaultModel(config: Config): string {
	const defaultModels = config.getPreferences().agents.defaultModels;
	const firstModel = defaultModels[0];
	if (!firstModel) {
		throw new Error('No default models configured in preferences.toml');
	}
	return firstModel;
}
