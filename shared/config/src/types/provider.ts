import { type Static, Type } from '@sinclair/typebox';
import { type SecretReference, SecretReferenceSchema } from './secret.js';

/**
 * Provider API protocols supported by the runtime adapters.
 */
export const PROVIDER_API_TYPES = ['anthropic', 'openai', 'google'] as const;

export type ProviderApiType = (typeof PROVIDER_API_TYPES)[number];

export const ProviderApiTypeSchema = Type.Union(PROVIDER_API_TYPES.map((type) => Type.Literal(type)));

/**
 * Check whether a value is a supported provider API protocol.
 */
export function isProviderApiType(value: string): value is ProviderApiType {
	return PROVIDER_API_TYPES.some((type) => type === value);
}

/**
 * TypeBox schema for provider configuration
 */
export const ProviderConfigSchema = Type.Object({
	type: ProviderApiTypeSchema,
	baseUrl: Type.String({ description: 'The base URL for the provider API' }),
	credential: SecretReferenceSchema,
});

/**
 * Provider configuration with a secret reference for credentials
 */
export interface ProviderConfig {
	type: ProviderApiType;
	baseUrl: string;
	credential: SecretReference;
}

/**
 * TypeBox schema for resolved provider configuration
 */
export const ResolvedProviderConfigSchema = Type.Object({
	type: ProviderApiTypeSchema,
	baseUrl: Type.String({ description: 'The base URL for the provider API' }),
	credentialEnvVar: Type.String({
		description: 'The environment variable name that will contain the actual credential',
	}),
});

/**
 * Resolved provider configuration with the credential env var name
 */
export type ResolvedProviderConfig = Static<typeof ResolvedProviderConfigSchema>;
