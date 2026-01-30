/**
 * Pi adapter types.
 */

/**
 * Options for creating a Pi adapter.
 */
export interface PiAdapterOptions {
	/** Provider to use */
	provider: 'anthropic' | 'openai' | 'google';
	/** Model to use */
	model: string;
	/** API key (or getter function) */
	apiKey?: string | (() => Promise<string | undefined>) | undefined;
	/** Thinking level */
	thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | undefined;
	/** Base URL for the API */
	baseUrl?: string | undefined;
}
