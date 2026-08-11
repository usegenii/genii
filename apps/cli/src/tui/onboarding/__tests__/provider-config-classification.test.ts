import { getModelsForProvider } from '@genii/config/providers/definitions';
import type { ProviderConfig } from '@genii/config/types/provider';
import type { SecretReference } from '@genii/config/types/secret';
import { describe, expect, it } from 'vitest';
import { buildProviderTree, findExistingProviderInfo } from '../components/provider-selector';
import { isBuiltinProviderConfig } from '../existing-config-loader';
import { buildModelOptions, validateSlug } from '../pages/provider-setup';
import type { ExistingConfig } from '../types';

const BUILTIN_GOOGLE_CONFIG: ProviderConfig = {
	type: 'google',
	baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
	credential: 'secret:google-api-key' as SecretReference,
};

describe('existing provider classification', () => {
	it('recognizes Google only when its stored contract matches the built-in provider', () => {
		expect(isBuiltinProviderConfig('google', BUILTIN_GOOGLE_CONFIG)).toBe(true);
		expect(
			isBuiltinProviderConfig('google', {
				...BUILTIN_GOOGLE_CONFIG,
				baseUrl: 'https://google-proxy.example/v1beta',
			}),
		).toBe(false);
		expect(
			isBuiltinProviderConfig('google', {
				...BUILTIN_GOOGLE_CONFIG,
				type: 'openai',
			}),
		).toBe(false);
	});

	it('does not classify arbitrary provider IDs as built-in', () => {
		expect(isBuiltinProviderConfig('my-google', BUILTIN_GOOGLE_CONFIG)).toBe(false);
	});
});

describe('provider slug validation', () => {
	it('allows an existing custom provider to retain a newly reserved ID', () => {
		expect(validateSlug('google', ['google'], 'google')).toBeNull();
	});

	it('keeps built-in IDs reserved for new or renamed custom providers', () => {
		expect(validateSlug('google', [])).toBe('"google" is a reserved provider name');
		expect(validateSlug('zai', ['google'], 'google')).toBe('"zai" is a reserved provider name');
	});
});

describe('provider selector classification', () => {
	it('shows a legacy custom [google] entry only in the configured custom section', () => {
		const existingConfig: ExistingConfig = {
			providers: [
				{
					providerId: 'google',
					config: { ...BUILTIN_GOOGLE_CONFIG, baseUrl: 'https://google-proxy.example/v1beta' },
					isBuiltin: false,
					hasStoredApiKey: true,
				},
			],
			models: [],
			channels: [],
			hasExistingPreferences: true,
		};

		const tree = buildProviderTree(existingConfig);
		const builtinNode = tree.find((node) => node.id === 'builtin');
		const configuredCustomNode = tree.find((node) => node.id === 'configured-custom');

		expect(builtinNode?.children?.some((node) => node.id === 'google')).toBe(false);
		expect(configuredCustomNode?.children).toEqual([{ id: 'google', label: 'google [configured]' }]);
		expect(findExistingProviderInfo(existingConfig, 'google', false)?.providerId).toBe('google');
		expect(findExistingProviderInfo(existingConfig, 'google', true)).toBeUndefined();
	});

	it('marks a matching built-in Google provider as configured', () => {
		const existingConfig: ExistingConfig = {
			providers: [
				{
					providerId: 'google',
					config: BUILTIN_GOOGLE_CONFIG,
					isBuiltin: true,
					hasStoredApiKey: true,
				},
			],
			models: [],
			channels: [],
			hasExistingPreferences: true,
		};

		const builtinNode = buildProviderTree(existingConfig).find((node) => node.id === 'builtin');
		expect(builtinNode?.children?.find((node) => node.id === 'google')?.label).toBe(
			'Google Generative AI [configured]',
		);
	});
});

describe('existing model aliases', () => {
	it('adds an existing alias to the selectable model list', () => {
		const options = buildModelOptions(getModelsForProvider('google'), [
			{
				modelId: 'flash',
				providerId: 'google',
				config: { provider: 'google', modelId: 'gemini-2.5-flash' },
			},
		]);

		expect(options).toContainEqual({
			value: 'flash',
			label: 'flash [existing]',
			description: 'Model ID: gemini-2.5-flash',
		});
	});

	it('shows the stored API model ID when a catalog-named entry points elsewhere', () => {
		const options = buildModelOptions(getModelsForProvider('google'), [
			{
				modelId: 'gemini-3.6-flash',
				providerId: 'google',
				config: { provider: 'google', modelId: 'custom-gemini-flash' },
			},
		]);

		expect(options.find((option) => option.value === 'gemini-3.6-flash')).toMatchObject({
			label: 'Gemini 3.6 Flash [existing]',
			description: expect.stringContaining('Model ID: custom-gemini-flash'),
		});
	});
});
