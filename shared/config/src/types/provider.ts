import { type Static, Type } from '@sinclair/typebox';
import { type SecretReference, SecretReferenceSchema } from './secret.js';

/**
 * TypeBox schema for provider configuration
 */
export const ProviderConfigSchema = Type.Object({
	type: Type.String({ description: 'The provider type (e.g., "anthropic", "openai")' }),
	baseUrl: Type.String({ description: 'The base URL for the provider API' }),
	credential: SecretReferenceSchema,
});

/**
 * Provider configuration with a secret reference for credentials
 */
export interface ProviderConfig {
	type: string;
	baseUrl: string;
	credential: SecretReference;
}

/**
 * TypeBox schema for resolved provider configuration
 */
export const ResolvedProviderConfigSchema = Type.Object({
	type: Type.String({ description: 'The provider type (e.g., "anthropic", "openai")' }),
	baseUrl: Type.String({ description: 'The base URL for the provider API' }),
	credentialEnvVar: Type.String({
		description: 'The environment variable name that will contain the actual credential',
	}),
});

/**
 * Resolved provider configuration with the credential env var name
 */
export type ResolvedProviderConfig = Static<typeof ResolvedProviderConfigSchema>;
