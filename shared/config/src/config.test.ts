import { describe, expect, it } from 'vitest';
import { createConfig } from './config.js';
import type { ChannelsLoadResult } from './loaders/channels.js';
import type { ChannelConfig, ChannelsConfig } from './types/channel.js';
import type { ModelConfig } from './types/model.js';
import type { PreferencesConfig } from './types/preferences.js';
import type { ProviderConfig } from './types/provider.js';
import type { SecretReference } from './types/secret.js';

/**
 * Helper to create a SecretReference from a string
 */
function secretRef(name: string): SecretReference {
	return `secret:${name}` as SecretReference;
}

describe('Config', () => {
	// Mock data for tests
	const mockProviders: Record<string, ProviderConfig> = {
		anthropic: {
			type: 'anthropic',
			baseUrl: 'https://api.anthropic.com',
			credential: secretRef('anthropic-api-key'),
		},
		openai: {
			type: 'openai',
			baseUrl: 'https://api.openai.com/v1',
			credential: secretRef('openai-api-key'),
		},
	};

	const mockModels: Record<string, ModelConfig> = {
		'claude-opus': {
			provider: 'anthropic',
			modelId: 'claude-opus-4-5-20251101',
		},
		'gpt-4': {
			provider: 'openai',
			modelId: 'gpt-4-turbo',
		},
	};

	const mockChannelSettings: ChannelsConfig = {
		maxMessageLength: 4000,
		rateLimitPerMinute: 60,
	};

	const mockChannels: Record<string, ChannelConfig> = {
		'telegram-personal': {
			type: 'telegram',
			credential: secretRef('telegram-bot-token'),
			allowedUserIds: ['123456789'],
			pollingIntervalMs: 1000,
		},
		'telegram-work': {
			type: 'telegram',
			credential: secretRef('telegram-work-token'),
			allowedUserIds: ['987654321', '555555555'],
			pollingIntervalMs: 2000,
		},
	};

	const mockChannelsData: ChannelsLoadResult = {
		settings: mockChannelSettings,
		channels: mockChannels,
	};

	const mockPreferences: PreferencesConfig = {
		agents: {
			defaultModels: ['claude-opus', 'gpt-4'],
		},
		logging: {
			level: 'info',
		},
	};

	function createTestConfig() {
		return createConfig(mockProviders, mockModels, mockChannelsData, mockPreferences);
	}

	describe('getProviders', () => {
		it('returns all providers', () => {
			const config = createTestConfig();
			const providers = config.getProviders();

			expect(providers).toEqual(mockProviders);
			expect(Object.keys(providers)).toHaveLength(2);
			expect(providers).toHaveProperty('anthropic');
			expect(providers).toHaveProperty('openai');
		});
	});

	describe('getProvider', () => {
		it('returns a specific provider', () => {
			const config = createTestConfig();
			const provider = config.getProvider('anthropic');

			expect(provider).toEqual({
				type: 'anthropic',
				baseUrl: 'https://api.anthropic.com',
				credential: 'secret:anthropic-api-key',
			});
		});

		it('returns undefined for non-existent provider', () => {
			const config = createTestConfig();
			const provider = config.getProvider('non-existent');

			expect(provider).toBeUndefined();
		});
	});

	describe('getModels', () => {
		it('returns all models', () => {
			const config = createTestConfig();
			const models = config.getModels();

			expect(models).toEqual(mockModels);
			expect(Object.keys(models)).toHaveLength(2);
			expect(models).toHaveProperty('claude-opus');
			expect(models).toHaveProperty('gpt-4');
		});
	});

	describe('getModel', () => {
		it('returns a specific model', () => {
			const config = createTestConfig();
			const model = config.getModel('claude-opus');

			expect(model).toEqual({
				provider: 'anthropic',
				modelId: 'claude-opus-4-5-20251101',
			});
		});

		it('returns undefined for non-existent model', () => {
			const config = createTestConfig();
			const model = config.getModel('non-existent');

			expect(model).toBeUndefined();
		});
	});

	describe('getChannelSettings', () => {
		it('returns channel settings', () => {
			const config = createTestConfig();
			const settings = config.getChannelSettings();

			expect(settings).toEqual({
				maxMessageLength: 4000,
				rateLimitPerMinute: 60,
			});
		});
	});

	describe('getChannels', () => {
		it('returns all channels', () => {
			const config = createTestConfig();
			const channels = config.getChannels();

			expect(channels).toEqual(mockChannels);
			expect(Object.keys(channels)).toHaveLength(2);
			expect(channels).toHaveProperty('telegram-personal');
			expect(channels).toHaveProperty('telegram-work');
		});
	});

	describe('getChannel', () => {
		it('returns a specific channel', () => {
			const config = createTestConfig();
			const channel = config.getChannel('telegram-personal');

			expect(channel).toEqual({
				type: 'telegram',
				credential: 'secret:telegram-bot-token',
				allowedUserIds: ['123456789'],
				pollingIntervalMs: 1000,
			});
		});

		it('returns undefined for non-existent channel', () => {
			const config = createTestConfig();
			const channel = config.getChannel('non-existent');

			expect(channel).toBeUndefined();
		});
	});

	describe('getPreferences', () => {
		it('returns preferences', () => {
			const config = createTestConfig();
			const preferences = config.getPreferences();

			expect(preferences).toEqual({
				agents: {
					defaultModels: ['claude-opus', 'gpt-4'],
				},
				logging: {
					level: 'info',
				},
			});
		});
	});
});
