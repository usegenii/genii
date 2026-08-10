import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@genii/config/config';
import type { SecretStore } from '@genii/config/secrets/types';
import { ModelFactory } from '@genii/models/factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOnboarding } from '../complete';
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

		await expect(completeOnboarding(state, join(configPath, 'guidance'))).resolves.toMatchObject({ success: true });

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

		await expect(completeOnboarding(state, join(configPath, 'guidance'))).resolves.toMatchObject({ success: true });

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
