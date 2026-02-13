/**
 * ModelFactory: bridges config + secrets to adapter creation.
 */

import type { Config } from '@genii/config/config';
import type { SecretStore } from '@genii/config/secrets/types';
import { getSecretName, isSecretReference } from '@genii/config/types/secret';
import { createPiAdapter } from '@genii/orchestrator/adapters/pi/adapter';
import type { PiAdapterOptions } from '@genii/orchestrator/adapters/pi/types';
import type { AgentAdapter } from '@genii/orchestrator/adapters/types';
import { isValidProviderType, resolveThinkingLevel } from './capabilities';
import { parseModelIdentifier } from './identifier';
import type { ModelFactoryOptions, ProviderType, ResolvedModelConfig, SessionModelOptions } from './types';

/**
 * Factory for creating model adapters from configuration.
 */
export class ModelFactory {
	private readonly config: Config;
	private readonly secretStore: SecretStore;

	constructor(options: ModelFactoryOptions) {
		this.config = options.config;
		this.secretStore = options.secretStore;
	}

	/**
	 * Create an adapter for the specified model.
	 *
	 * @param modelIdentifier - Model identifier in format "provider/model-name"
	 * @param sessionOptions - Optional session-level overrides
	 * @returns A configured AgentAdapter
	 * @throws Error if the model or provider is not found, or credentials cannot be resolved
	 */
	async createAdapter(modelIdentifier: string, sessionOptions?: SessionModelOptions): Promise<AgentAdapter> {
		const resolved = await this.resolveModel(modelIdentifier, sessionOptions);
		return this.buildAdapter(resolved);
	}

	/**
	 * Resolve a model identifier to a fully-resolved configuration.
	 *
	 * @param modelIdentifier - Model identifier in format "provider/model-name"
	 * @param sessionOptions - Optional session-level overrides
	 * @returns Resolved model configuration with all values needed to create an adapter
	 */
	async resolveModel(modelIdentifier: string, sessionOptions?: SessionModelOptions): Promise<ResolvedModelConfig> {
		// Parse the identifier
		const { provider: providerName, modelName } = parseModelIdentifier(modelIdentifier);

		// Look up model configuration
		const modelConfig = this.config.getModel(modelName);
		if (!modelConfig) {
			throw new Error(`Model "${modelName}" not found in configuration`);
		}

		// Verify the provider matches
		if (modelConfig.provider !== providerName) {
			throw new Error(
				`Model "${modelName}" is configured with provider "${modelConfig.provider}", but identifier specifies "${providerName}"`,
			);
		}

		// Look up provider configuration
		const providerConfig = this.config.getProvider(providerName);
		if (!providerConfig) {
			throw new Error(`Provider "${providerName}" not found in configuration`);
		}

		// Validate provider type
		if (!isValidProviderType(providerConfig.type)) {
			throw new Error(`Invalid provider type "${providerConfig.type}" for provider "${providerName}"`);
		}
		const providerType: ProviderType = providerConfig.type;

		// Resolve the API key from the secret store
		const apiKey = await this.resolveCredential(providerConfig.credential);

		// Resolve thinking level using the priority chain
		const thinkingLevel = resolveThinkingLevel(
			providerType,
			modelConfig.thinkingLevel,
			sessionOptions?.thinkingLevel,
		);

		return {
			providerType,
			userProviderName: providerName,
			userModelName: modelName,
			modelId: modelConfig.modelId,
			apiKey,
			baseUrl: providerConfig.baseUrl,
			thinkingLevel,
		};
	}

	/**
	 * Resolve a credential from the secret store.
	 */
	private async resolveCredential(credential: string): Promise<string> {
		if (!isSecretReference(credential)) {
			// Direct value (not recommended but supported)
			return credential;
		}

		const secretName = getSecretName(credential);
		const result = await this.secretStore.get(secretName);

		if (!result.success) {
			throw new Error(`Failed to resolve secret "${secretName}": ${result.error}`);
		}

		return result.value;
	}

	/**
	 * Build an adapter from resolved configuration.
	 */
	private buildAdapter(resolved: ResolvedModelConfig): AgentAdapter {
		const options: PiAdapterOptions = {
			providerType: resolved.providerType,
			userProviderName: resolved.userProviderName,
			userModelName: resolved.userModelName,
			modelId: resolved.modelId,
			apiKey: resolved.apiKey,
			baseUrl: resolved.baseUrl,
			thinkingLevel: resolved.thinkingLevel,
		};

		return createPiAdapter(options);
	}

	/**
	 * List all available model identifiers.
	 *
	 * @returns Array of model identifiers in format "provider/model-name"
	 */
	listModels(): string[] {
		const models = this.config.getModels();
		return Object.entries(models).map(([name, config]) => `${config.provider}/${name}`);
	}

	/**
	 * Check if a model identifier is valid and configured.
	 *
	 * @param modelIdentifier - Model identifier to check
	 * @returns true if the model exists and is properly configured
	 */
	hasModel(modelIdentifier: string): boolean {
		try {
			const { provider, modelName } = parseModelIdentifier(modelIdentifier);
			const modelConfig = this.config.getModel(modelName);
			if (!modelConfig || modelConfig.provider !== provider) {
				return false;
			}
			const providerConfig = this.config.getProvider(provider);
			return providerConfig !== undefined;
		} catch {
			return false;
		}
	}
}

/**
 * Create a ModelFactory instance.
 */
export function createModelFactory(options: ModelFactoryOptions): ModelFactory {
	return new ModelFactory(options);
}
