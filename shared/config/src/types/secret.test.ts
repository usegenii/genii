import { describe, expect, it } from 'vitest';
import { getSecretName, isSecretReference, type SecretReference } from './secret.js';

describe('isSecretReference', () => {
	it('returns true for strings starting with "secret:"', () => {
		expect(isSecretReference('secret:my-api-key')).toBe(true);
		expect(isSecretReference('secret:database-password')).toBe(true);
		expect(isSecretReference('secret:a')).toBe(true);
	});

	it('returns false for strings not starting with "secret:"', () => {
		expect(isSecretReference('my-api-key')).toBe(false);
		expect(isSecretReference('SECRET:my-api-key')).toBe(false);
		expect(isSecretReference('secrets:my-api-key')).toBe(false);
		expect(isSecretReference('')).toBe(false);
		expect(isSecretReference('secret')).toBe(false);
		expect(isSecretReference('mysecret:key')).toBe(false);
	});
});

describe('getSecretName', () => {
	it('extracts the secret name correctly', () => {
		expect(getSecretName('secret:my-api-key' as SecretReference)).toBe('my-api-key');
		expect(getSecretName('secret:database-password' as SecretReference)).toBe('database-password');
		expect(getSecretName('secret:a' as SecretReference)).toBe('a');
		expect(getSecretName('secret:' as SecretReference)).toBe('');
		expect(getSecretName('secret:nested/path/to/secret' as SecretReference)).toBe('nested/path/to/secret');
	});
});
