import { describe, expect, it } from 'vitest';
import { CUSTOM_PROVIDER_DEFINITION, getModelsForProvider, getProvider } from './definitions.js';

describe('Google provider definitions', () => {
	it('defines a supported Google Generative AI API-key setup', () => {
		const provider = getProvider('google');

		expect(provider).toMatchObject({
			id: 'google',
			name: 'Google Generative AI',
			apiType: 'google',
			defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
		});
		expect(provider?.authMethods).toEqual([
			expect.objectContaining({
				type: 'api-key',
				fields: [expect.objectContaining({ id: 'apiKey', required: true })],
			}),
		]);
	});

	it('offers Gemini 3.6 Flash as a built-in model', () => {
		expect(getModelsForProvider('google')).toContainEqual(
			expect.objectContaining({
				id: 'gemini-3.6-flash',
				name: 'Gemini 3.6 Flash',
				provider: 'google',
			}),
		);
	});

	it('offers the Google protocol for custom providers', () => {
		const apiTypeField = CUSTOM_PROVIDER_DEFINITION.commonFields?.find((field) => field.id === 'apiType');

		expect(apiTypeField?.options).toContainEqual({
			value: 'google',
			label: 'Google Generative AI API',
		});
	});
});
