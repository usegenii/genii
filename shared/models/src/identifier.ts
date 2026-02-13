/**
 * Model identifier parsing and creation utilities.
 */

import type { ModelIdentifier, ParsedModelIdentifier } from './types';

/**
 * Parse a model identifier string into provider and model name components.
 *
 * The provider is everything before the first slash. The model name is
 * everything after, and may itself contain slashes.
 *
 * @param identifier - Model identifier in format "provider/model-name"
 * @returns Parsed components
 * @throws Error if the identifier format is invalid
 */
export function parseModelIdentifier(identifier: string): ParsedModelIdentifier {
	const slashIndex = identifier.indexOf('/');
	if (slashIndex <= 0 || slashIndex === identifier.length - 1) {
		throw new Error(
			`Invalid model identifier format: "${identifier}". Expected format: "provider/model-name" (e.g., "anthropic/opus-4.5")`,
		);
	}
	return {
		provider: identifier.slice(0, slashIndex),
		modelName: identifier.slice(slashIndex + 1),
	};
}

/**
 * Create a model identifier from provider and model name.
 * @param provider - Provider name
 * @param modelName - Model name
 * @returns Model identifier string
 */
export function createModelIdentifier(provider: string, modelName: string): ModelIdentifier {
	return `${provider}/${modelName}` as ModelIdentifier;
}
