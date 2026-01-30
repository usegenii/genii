import { type TString, Type } from '@sinclair/typebox';

/**
 * A branded type for secret references - strings that start with 'secret:'
 */
export type SecretReference = string & { readonly __brand: 'SecretReference' };

/**
 * TypeBox schema for secret reference strings
 */
export const SecretReferenceSchema: TString = Type.String({
	pattern: '^secret:.+$',
	description: 'A reference to a secret, formatted as "secret:<secret-name>"',
});

/**
 * Check if a string is a secret reference (starts with 'secret:')
 */
export function isSecretReference(value: string): value is SecretReference {
	return value.startsWith('secret:');
}

/**
 * Extract the secret name from a secret reference (removes 'secret:' prefix)
 */
export function getSecretName(ref: SecretReference): string {
	return ref.slice(7); // 'secret:'.length === 7
}
