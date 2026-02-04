/**
 * Field types for config-driven forms.
 */
export type SetupFieldType = 'text' | 'password' | 'select';

/**
 * Option for select fields.
 */
export interface SetupFieldOption {
	value: string;
	label: string;
}

/**
 * Field definition for config-driven forms.
 */
export interface SetupField {
	id: string;
	type: SetupFieldType;
	label: string;
	hint?: string;
	placeholder?: string;
	required?: boolean;
	options?: SetupFieldOption[]; // For select fields
}

/**
 * Authentication method for a provider.
 */
export interface AuthMethod {
	type: 'api-key' | 'oauth';
	name: string;
	description: string;
	fields: SetupField[]; // Fields specific to this auth method
}

/**
 * Definition of a provider (built-in or custom).
 */
export interface ProviderDefinition {
	id: string;
	name: string;
	apiType: 'anthropic' | 'openai';
	defaultBaseUrl?: string;
	commonFields?: SetupField[]; // Fields shown before auth method selection
	authMethods: AuthMethod[];
}

/**
 * Definition of a model available from a provider.
 */
export interface ModelDefinition {
	id: string;
	name: string;
	provider: string;
	contextWindow?: number;
	maxOutputTokens?: number;
}
