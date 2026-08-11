import { createConfig } from '@genii/config/config';
import type { SecretStore } from '@genii/config/secrets/types';
import type { SecretReference } from '@genii/config/types/secret';
import { PiAgentAdapter } from '@genii/orchestrator/adapters/pi/adapter';
import { describe, expect, it, vi } from 'vitest';
import { ModelFactory } from '../factory';

describe('ModelFactory', () => {
	it('creates a Google Pi adapter from the supported Google configuration', async () => {
		const config = createConfig(
			{
				google: {
					type: 'google',
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
					credential: 'secret:google-api-key' as SecretReference,
				},
			},
			{
				'gemini-flash': {
					provider: 'google',
					modelId: 'gemini-3.6-flash',
				},
			},
			{
				settings: { maxMessageLength: 4000, rateLimitPerMinute: 60 },
				channels: {},
			},
			{
				agents: { defaultModels: ['google/gemini-flash'] },
				logging: { level: 'info' },
			},
		);
		const secretStore: SecretStore = {
			get: vi.fn().mockResolvedValue({ success: true, value: 'google-test-api-key' }),
			set: vi.fn(),
		};
		const factory = new ModelFactory({ config, secretStore });

		await expect(factory.resolveModel('google/gemini-flash')).resolves.toEqual({
			providerType: 'google',
			userProviderName: 'google',
			userModelName: 'gemini-flash',
			modelId: 'gemini-3.6-flash',
			apiKey: 'google-test-api-key',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			thinkingLevel: 'off',
		});
		expect(secretStore.get).toHaveBeenCalledWith('google-api-key');

		const adapter = await factory.createAdapter('google/gemini-flash');
		expect(adapter).toBeInstanceOf(PiAgentAdapter);
		expect(adapter.modelProvider).toBe('google');
		expect(adapter.modelName).toBe('gemini-flash');
	});
});
