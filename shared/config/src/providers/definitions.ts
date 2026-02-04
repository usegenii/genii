import type { ModelDefinition, ProviderDefinition, SetupField } from './types.js';

// Re-export types for convenience
export type {
	AuthMethod,
	ModelDefinition,
	ProviderDefinition,
	SetupField,
	SetupFieldOption,
	SetupFieldType,
} from './types.js';

/**
 * Common API key field used by most providers.
 */
const API_KEY_FIELD: SetupField = {
	id: 'apiKey',
	type: 'password',
	label: 'API Key',
	placeholder: 'Enter your API key',
	hint: 'Your key will be stored securely',
	required: true,
};

/**
 * Built-in provider definitions.
 * MVP: Z.ai Coding Plan (OpenAI API compatible)
 */
export const BUILTIN_PROVIDERS: ProviderDefinition[] = [
	{
		id: 'zai',
		name: 'Z.ai Coding Plan',
		apiType: 'openai',
		defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
		authMethods: [
			{
				type: 'api-key',
				name: 'API Key',
				description: 'Enter your Z.ai API key',
				fields: [API_KEY_FIELD],
			},
		],
	},
];

/**
 * Custom provider definition.
 * Allows users to configure any API-compatible provider.
 */
export const CUSTOM_PROVIDER_DEFINITION: ProviderDefinition = {
	id: 'custom',
	name: 'Custom Provider',
	apiType: 'anthropic',
	commonFields: [
		{
			id: 'apiType',
			type: 'select',
			label: 'API Type',
			hint: 'Select the API format your provider uses',
			options: [
				{ value: 'anthropic', label: 'Anthropic API' },
				{ value: 'openai', label: 'OpenAI-compatible API' },
			],
		},
		{
			id: 'baseUrl',
			type: 'text',
			label: 'Base URL',
			placeholder: 'https://api.example.com',
			hint: 'The base URL for API requests',
			required: true,
		},
	],
	authMethods: [
		{
			type: 'api-key',
			name: 'API Key',
			description: 'Authenticate with an API key',
			fields: [API_KEY_FIELD],
		},
	],
};

/**
 * Get all providers (builtin + custom).
 */
export function getAllProviders(): ProviderDefinition[] {
	return [...BUILTIN_PROVIDERS, CUSTOM_PROVIDER_DEFINITION];
}

/**
 * Built-in model definitions.
 */
export const BUILTIN_MODELS: ModelDefinition[] = [
	{
		id: 'glm-4.7',
		name: 'GLM 4.7',
		provider: 'zai',
		contextWindow: 128000,
		maxOutputTokens: 4096,
	},
];

/**
 * Get a provider by ID.
 */
export function getProvider(id: string): ProviderDefinition | undefined {
	return BUILTIN_PROVIDERS.find((p) => p.id === id);
}

/**
 * Get all models for a provider.
 */
export function getModelsForProvider(providerId: string): ModelDefinition[] {
	return BUILTIN_MODELS.filter((m) => m.provider === providerId);
}
