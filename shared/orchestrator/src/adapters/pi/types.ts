/**
 * Pi adapter types.
 */

/**
 * Options for creating a Pi adapter.
 */
export interface PiAdapterOptions {
	/** Provider type (anthropic, openai, google) - used for API routing */
	providerType: 'anthropic' | 'openai' | 'google';
	/** User-defined provider name from config (for checkpointing) */
	userProviderName: string;
	/** User-defined model name from config (for checkpointing) */
	userModelName: string;
	/** Model ID to pass to the API */
	modelId: string;
	/** API key (or getter function) */
	apiKey?: string | (() => Promise<string | undefined>) | undefined;
	/** Thinking level */
	thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | undefined;
	/** Base URL for the API */
	baseUrl?: string | undefined;
}
