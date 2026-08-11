import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@genii/config/config';
import type { SecretStore } from '@genii/config/secrets/types';
import type { SecretReference } from '@genii/config/types/secret';
import { saveModelsConfig } from '@genii/config/writers/models';
import { saveProvidersConfig } from '@genii/config/writers/providers';
import { ModelFactory } from '@genii/models/factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOnboarding } from '../complete';
import { isBuiltinProviderConfig, loadExistingConfig } from '../existing-config-loader';
import { existingToInstanceStates } from '../pages/provider-setup';
import type { OnboardingState } from '../types';
import { DEFAULT_STATE } from '../types';

const { secrets, secretStore } = vi.hoisted(() => {
	const storedSecrets = new Map<string, string>();
	const store: SecretStore = {
		get: vi.fn(async (name: string) => {
			const value = storedSecrets.get(name);
			return value === undefined
				? { success: false as const, error: `Secret '${name}' not found` }
				: { success: true as const, value };
		}),
		set: vi.fn(async (name: string, value: string) => {
			storedSecrets.set(name, value);
			return { success: true as const, value };
		}),
	};
	return { secrets: storedSecrets, secretStore: store };
});

vi.mock('@genii/config/secrets/composite', () => ({
	createSecretStore: vi.fn().mockResolvedValue(secretStore),
}));

vi.mock('../../../client', () => ({
	createDaemonClient: vi.fn().mockReturnValue({
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		onboardExecute: vi.fn().mockResolvedValue({ copied: [], backedUp: [], skipped: [] }),
	}),
}));

describe('completeOnboarding configuration integration', () => {
	let configPath: string;

	beforeEach(async () => {
		configPath = await mkdtemp(join(tmpdir(), 'genii-onboarding-config-'));
		secrets.clear();
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await rm(configPath, { recursive: true, force: true });
	});

	it('writes and resolves the omniroute/auto-agent default model', async () => {
		const state: OnboardingState = {
			...DEFAULT_STATE,
			disclaimerAccepted: true,
			providers: [
				{
					id: 'omniroute',
					type: 'custom',
					custom: {
						apiType: 'openai',
						baseUrl: 'https://api.omniroute.example/v1',
						apiKey: 'test-api-key',
					},
					selectedModels: ['auto-agent'],
				},
			],
		};

		await expect(completeOnboarding(state, configPath)).resolves.toMatchObject({ success: true });

		const config = await loadConfig({ basePath: configPath });
		expect(config.getModel('auto-agent')).toEqual({
			provider: 'omniroute',
			modelId: 'auto-agent',
		});

		const defaultModel = config.getPreferences().agents.defaultModels[0];
		expect(defaultModel).toBe('omniroute/auto-agent');
		if (!defaultModel) {
			throw new Error('Expected onboarding to configure a default model');
		}

		const factory = new ModelFactory({ config, secretStore });
		await expect(factory.resolveModel(defaultModel)).resolves.toEqual({
			providerType: 'openai',
			userProviderName: 'omniroute',
			userModelName: 'auto-agent',
			modelId: 'auto-agent',
			apiKey: 'test-api-key',
			baseUrl: 'https://api.omniroute.example/v1',
			thinkingLevel: 'off',
		});

		const adapter = await factory.createAdapter(defaultModel);
		expect(adapter.modelProvider).toBe('omniroute');
		expect(adapter.modelName).toBe('auto-agent');
	});

	it('writes and resolves the built-in Google model through ModelFactory', async () => {
		const state: OnboardingState = {
			...DEFAULT_STATE,
			disclaimerAccepted: true,
			providers: [
				{
					id: 'google',
					type: 'builtin',
					builtinId: 'google',
					apiKey: 'test-google-api-key',
					selectedModels: ['gemini-3.6-flash'],
				},
			],
		};

		await expect(completeOnboarding(state, configPath)).resolves.toMatchObject({ success: true });

		const config = await loadConfig({ basePath: configPath });
		expect(config.getProvider('google')).toEqual({
			type: 'google',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			credential: 'secret:google-api-key',
		});
		expect(config.getModel('gemini-3.6-flash')).toEqual({
			provider: 'google',
			modelId: 'gemini-3.6-flash',
		});
		expect(config.getPreferences().agents).toMatchObject({
			defaultModels: ['google/gemini-3.6-flash'],
			tools: { shell: { defaultTimeout: 30_000 } },
		});
		expect(secrets.get('google-api-key')).toBe('test-google-api-key');

		const factory = new ModelFactory({ config, secretStore });
		await expect(factory.resolveModel('google/gemini-3.6-flash')).resolves.toEqual({
			providerType: 'google',
			userProviderName: 'google',
			userModelName: 'gemini-3.6-flash',
			modelId: 'gemini-3.6-flash',
			apiKey: 'test-google-api-key',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			thinkingLevel: 'off',
		});

		const adapter = await factory.createAdapter('google/gemini-3.6-flash');
		expect(adapter.modelProvider).toBe('google');
		expect(adapter.modelName).toBe('gemini-3.6-flash');
	});

	it('retains an existing direct credential without copying it into editable provider state', async () => {
		const directCredential = 'direct-existing-google-api-key';
		await saveProvidersConfig(configPath, {
			google: {
				type: 'google',
				baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
				credential: directCredential,
			},
		});
		await saveModelsConfig(configPath, {
			'gemini-2.5-flash': {
				provider: 'google',
				modelId: 'gemini-2.5-flash',
			},
		});

		const existingConfig = await loadExistingConfig(configPath);
		expect(existingConfig.providers[0]?.hasStoredApiKey).toBe(true);

		const providers = existingToInstanceStates(existingConfig);
		expect(providers).toMatchObject([
			{
				id: 'google',
				type: 'builtin',
				keepExistingApiKey: true,
				selectedModels: ['gemini-2.5-flash'],
			},
		]);
		expect(providers[0]).not.toHaveProperty('apiKey');
		expect(JSON.stringify(providers)).not.toContain(directCredential);

		const state: OnboardingState = {
			...DEFAULT_STATE,
			disclaimerAccepted: true,
			providers,
			existingConfig,
		};
		await expect(completeOnboarding(state, configPath)).resolves.toMatchObject({ success: true });

		const config = await loadConfig({ basePath: configPath });
		expect(config.getProvider('google')?.credential).toBe(directCredential);
		expect(secrets.size).toBe(0);
	});

	it('preserves an existing custom Google provider whose endpoint does not match the built-in contract', async () => {
		const providerConfig = {
			type: 'google' as const,
			baseUrl: 'https://google-proxy.example/v1beta',
			credential: 'secret:legacy-google-token' as SecretReference,
		};
		const existingConfig = {
			providers: [
				{
					providerId: 'google',
					config: providerConfig,
					isBuiltin: isBuiltinProviderConfig('google', providerConfig),
					hasStoredApiKey: true,
				},
			],
			models: [
				{
					modelId: 'flash',
					providerId: 'google',
					config: { provider: 'google', modelId: 'gemini-2.5-flash' },
				},
			],
			channels: [],
			hasExistingPreferences: true,
		};
		secrets.set('legacy-google-token', 'existing-google-api-key');

		const providers = existingToInstanceStates(existingConfig);
		expect(providers).toMatchObject([
			{
				id: 'google',
				type: 'custom',
				keepExistingApiKey: true,
				custom: { apiType: 'google', baseUrl: 'https://google-proxy.example/v1beta' },
			},
		]);

		const state: OnboardingState = {
			...DEFAULT_STATE,
			disclaimerAccepted: true,
			providers,
			existingConfig,
		};
		await expect(completeOnboarding(state, configPath)).resolves.toMatchObject({ success: true });

		const config = await loadConfig({ basePath: configPath });
		expect(config.getProvider('google')).toEqual(providerConfig);
		expect(config.getModel('flash')).toEqual({
			provider: 'google',
			modelId: 'gemini-2.5-flash',
		});
		expect(secrets.get('legacy-google-token')).toBe('existing-google-api-key');
		expect(secrets.has('google-api-key')).toBe(false);
	});

	it('preserves prototype-shaped provider and model identifiers', async () => {
		const state: OnboardingState = {
			...DEFAULT_STATE,
			disclaimerAccepted: true,
			providers: [
				{
					id: '__proto__',
					type: 'custom',
					custom: {
						apiType: 'openai',
						baseUrl: 'https://api.prototype.example/v1',
						apiKey: 'prototype-api-key',
					},
					selectedModels: ['__proto__'],
				},
			],
		};

		await expect(completeOnboarding(state, configPath)).resolves.toMatchObject({ success: true });

		const config = await loadConfig({ basePath: configPath });
		expect(config.getProvider('__proto__')).toMatchObject({
			type: 'openai',
			baseUrl: 'https://api.prototype.example/v1',
		});
		expect(config.getModel('__proto__')).toEqual({
			provider: '__proto__',
			modelId: '__proto__',
		});
	});
});
