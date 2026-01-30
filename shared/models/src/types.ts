/**
 * Types for the models package.
 */

import type { Config } from '@geniigotchi/config/config';
import type { SecretStore } from '@geniigotchi/config/secrets/types';
import type { ThinkingLevel } from '@geniigotchi/config/types/model';

/**
 * Supported provider types.
 */
export type ProviderType = 'anthropic' | 'openai' | 'google';

/**
 * Model identifier in the format "provider/model-name".
 * Example: "anthropic/opus-4.5" or "openai/gpt-4"
 */
export type ModelIdentifier = string & { readonly __brand: 'ModelIdentifier' };

/**
 * Parsed model identifier components.
 */
export interface ParsedModelIdentifier {
	provider: string;
	modelName: string;
}

/**
 * Options for creating a ModelFactory.
 */
export interface ModelFactoryOptions {
	/** Configuration instance */
	config: Config;
	/** Secret store for resolving credentials */
	secretStore: SecretStore;
}

/**
 * Resolved model configuration with all values needed to create an adapter.
 */
export interface ResolvedModelConfig {
	/** Provider type */
	providerType: ProviderType;
	/** Model ID to pass to the API */
	modelId: string;
	/** API key for authentication */
	apiKey: string;
	/** Base URL for the API */
	baseUrl: string;
	/** Thinking level (resolved from model config) */
	thinkingLevel: ThinkingLevel | undefined;
}

/**
 * Session-level options that can override model defaults.
 */
export interface SessionModelOptions {
	/** Override thinking level for this session */
	thinkingLevel?: ThinkingLevel;
}

/**
 * Parse a model identifier string into provider and model name components.
 * @param identifier - Model identifier in format "provider/model-name"
 * @returns Parsed components
 * @throws Error if the identifier format is invalid
 */
export function parseModelIdentifier(identifier: string): ParsedModelIdentifier {
	const parts = identifier.split('/');
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		throw new Error(
			`Invalid model identifier format: "${identifier}". Expected format: "provider/model-name" (e.g., "anthropic/opus-4.5")`,
		);
	}
	return {
		provider: parts[0],
		modelName: parts[1],
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
