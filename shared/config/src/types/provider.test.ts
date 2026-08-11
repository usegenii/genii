import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { isProviderApiType, ProviderApiTypeSchema, ProviderConfigSchema } from './provider.js';

describe('ProviderApiType', () => {
	it.each(['anthropic', 'openai', 'google'])('accepts %s', (apiType) => {
		expect(isProviderApiType(apiType)).toBe(true);
		expect(Value.Check(ProviderApiTypeSchema, apiType)).toBe(true);
	});

	it('rejects unsupported API types', () => {
		expect(isProviderApiType('google-vertex')).toBe(false);
		expect(Value.Check(ProviderApiTypeSchema, 'google-vertex')).toBe(false);
	});

	it('validates a Google provider configuration', () => {
		expect(
			Value.Check(ProviderConfigSchema, {
				type: 'google',
				baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
				credential: 'secret:google-api-key',
			}),
		).toBe(true);
	});
});
