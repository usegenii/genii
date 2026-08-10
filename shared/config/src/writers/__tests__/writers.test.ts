/**
 * Tests for config writers.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadChannelsConfig } from '../../loaders/channels.js';
import { loadModelsConfig } from '../../loaders/models.js';
import { loadProvidersConfig } from '../../loaders/providers.js';
import { readTomlTableMap } from '../../loaders/toml.js';
import { saveChannelsConfig } from '../channels.js';
import { saveModelsConfig } from '../models.js';
import { savePreferencesConfig } from '../preferences.js';
import { saveProvidersConfig } from '../providers.js';
import { writeTomlFile, writeTomlTableMap } from '../toml.js';

describe('Config Writers', () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `genii-test-${Date.now()}`);
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe('writeTomlFile', () => {
		it('should write TOML with kebab-case keys', async () => {
			const filePath = join(testDir, 'test.toml');
			await writeTomlFile(filePath, { baseUrl: 'http://example.com', apiKey: 'secret' });

			const content = await readFile(filePath, 'utf-8');
			expect(content).toContain('base-url = "http://example.com"');
			expect(content).toContain('api-key = "secret"');
		});

		it('should handle nested objects', async () => {
			const filePath = join(testDir, 'nested.toml');
			await writeTomlFile(filePath, {
				provider: {
					name: 'test',
					baseUrl: 'http://example.com',
				},
			});

			const content = await readFile(filePath, 'utf-8');
			expect(content).toContain('[provider]');
			expect(content).toContain('base-url = "http://example.com"');
		});

		it('should create directories if needed', async () => {
			const filePath = join(testDir, 'subdir', 'deep', 'test.toml');
			await writeTomlFile(filePath, { key: 'value' });

			const content = await readFile(filePath, 'utf-8');
			expect(content).toContain('key = "value"');
		});
	});

	describe('writeTomlTableMap', () => {
		it('should preserve __proto__ as an own table-map identifier', async () => {
			const filePath = join(testDir, 'prototype-identifier.toml');
			await writeTomlTableMap(filePath, { ['__proto__']: { schemaField: 'test-value' } });

			const result = await readTomlTableMap<{ schemaField: string }>(filePath);
			expect(Object.hasOwn(result, '__proto__')).toBe(true);
			expect(Reflect.get(result, '__proto__')).toEqual({ schemaField: 'test-value' });
		});
	});

	describe('savePreferencesConfig', () => {
		it('should save preferences to preferences.toml', async () => {
			await savePreferencesConfig(testDir, {
				logLevel: 'info',
				shellTimeout: 30_000,
			});

			const content = await readFile(join(testDir, 'preferences.toml'), 'utf-8');
			expect(content).toContain('[logging]');
			expect(content).toContain('level = "info"');
			expect(content).toContain('[agents.tools.shell]');
			expect(content).toContain('default-timeout = 30000');
		});
	});

	describe('saveProvidersConfig', () => {
		it('should save providers to providers.toml', async () => {
			await saveProvidersConfig(testDir, {
				zai: {
					type: 'anthropic',
					baseUrl: 'https://api.zai.com',
					credential: 'secret:zai-api-key',
				},
			});

			const content = await readFile(join(testDir, 'providers.toml'), 'utf-8');
			expect(content).toContain('[zai]');
			expect(content).toContain('type = "anthropic"');
			expect(content).toContain('base-url = "https://api.zai.com"');
			expect(content).toContain('credential = "secret:zai-api-key"');
		});

		it('should remove a provider by its verbatim hyphenated identifier', async () => {
			const filePath = join(testDir, 'providers.toml');
			await writeFile(
				filePath,
				`[custom-provider]
type = "openai"
base-url = "https://api.example.com/v1"
credential = "secret:custom-provider-api-key"
`,
				'utf-8',
			);

			await saveProvidersConfig(testDir, {}, ['custom-provider']);

			const content = await readFile(filePath, 'utf-8');
			expect(content).not.toContain('[custom-provider]');
		});

		it('should round-trip a case-sensitive provider identifier verbatim', async () => {
			await saveProvidersConfig(testDir, {
				myProvider: {
					type: 'openai',
					baseUrl: 'https://api.example.com/v1',
					credential: 'secret:my-provider-api-key',
				},
			});

			const providers = await loadProvidersConfig(testDir);
			expect(providers.myProvider?.baseUrl).toBe('https://api.example.com/v1');
			expect(providers['my-provider']).toBeUndefined();
		});

		it('should round-trip __proto__ as an exact provider identifier', async () => {
			await saveProvidersConfig(
				testDir,
				Object.fromEntries([
					[
						'__proto__',
						{
							type: 'openai',
							baseUrl: 'https://api.example.com/v1',
							credential: 'secret:prototype-provider-api-key',
						},
					],
				]),
			);

			const providers = await loadProvidersConfig(testDir);
			expect(Object.hasOwn(providers, '__proto__')).toBe(true);
			expect(Reflect.get(providers, '__proto__')).toEqual({
				type: 'openai',
				baseUrl: 'https://api.example.com/v1',
				credential: 'secret:prototype-provider-api-key',
			});
		});
	});

	describe('saveChannelsConfig', () => {
		it('should remove a channel by its verbatim hyphenated identifier', async () => {
			const filePath = join(testDir, 'channels.toml');
			await writeFile(
				filePath,
				`max-message-length = 5000

[telegram-personal]
type = "telegram"
credential = "secret:telegram-personal-credential"
allowed-user-ids = ["123456789"]
polling-interval-ms = 1000
`,
				'utf-8',
			);

			await saveChannelsConfig(testDir, {}, ['telegram-personal']);

			const content = await readFile(filePath, 'utf-8');
			expect(content).toContain('max-message-length = 5000');
			expect(content).not.toContain('[telegram-personal]');
		});

		it('should round-trip a case-sensitive channel identifier verbatim', async () => {
			await saveChannelsConfig(testDir, {
				telegramPersonal: {
					type: 'telegram',
					credential: 'secret:telegram-personal-credential',
					allowedUserIds: ['123456789'],
					pollingIntervalMs: 1000,
				},
			});

			const { channels } = await loadChannelsConfig(testDir);
			expect(channels.telegramPersonal?.type).toBe('telegram');
			expect(channels['telegram-personal']).toBeUndefined();
		});

		it('should distinguish an object-valued channel identifier from a numeric global setting', async () => {
			await saveChannelsConfig(testDir, {
				maxMessageLength: {
					type: 'telegram',
					credential: 'secret:max-message-length-credential',
					allowedUserIds: ['123456789'],
					pollingIntervalMs: 1000,
				},
			});

			const { settings, channels } = await loadChannelsConfig(testDir);
			expect(settings.maxMessageLength).toBe(4000);
			expect(channels.maxMessageLength?.type).toBe('telegram');
		});

		it('should preserve hyphenated channel identifiers that collide with camel-case numeric aliases', async () => {
			const filePath = join(testDir, 'channels.toml');
			await writeFile(
				filePath,
				`maxMessageLength = 4000
rateLimitPerMinute = 60

[max-message-length]
type = "telegram"
credential = "secret:max-message-length-channel"

[rate-limit-per-minute]
type = "discord"
credential = "secret:rate-limit-per-minute-channel"
`,
				'utf-8',
			);

			await saveChannelsConfig(testDir, {});

			const { settings, channels } = await loadChannelsConfig(testDir);
			expect(settings).toEqual({ maxMessageLength: 4000, rateLimitPerMinute: 60 });
			expect(channels['max-message-length']?.type).toBe('telegram');
			expect(channels['rate-limit-per-minute']?.type).toBe('discord');
		});

		it('should preserve kebab-case setting precedence over camel-case aliases across save and reload', async () => {
			const filePath = join(testDir, 'channels.toml');
			await writeFile(
				filePath,
				`max-message-length = 5000
maxMessageLength = 4000
rate-limit-per-minute = 120
rateLimitPerMinute = 60
`,
				'utf-8',
			);

			expect((await loadChannelsConfig(testDir)).settings).toEqual({
				maxMessageLength: 5000,
				rateLimitPerMinute: 120,
			});

			await saveChannelsConfig(testDir, {});

			expect((await loadChannelsConfig(testDir)).settings).toEqual({
				maxMessageLength: 5000,
				rateLimitPerMinute: 120,
			});
		});

		it('should not remove a scalar setting when asked to remove a same-named channel', async () => {
			const filePath = join(testDir, 'channels.toml');
			await writeFile(filePath, 'max-message-length = 5000\n', 'utf-8');

			await saveChannelsConfig(testDir, {}, ['max-message-length']);

			expect((await loadChannelsConfig(testDir)).settings.maxMessageLength).toBe(5000);
		});

		it('should reject a channel identifier that exactly collides with a scalar setting', async () => {
			const filePath = join(testDir, 'channels.toml');
			await writeFile(filePath, 'max-message-length = 5000\n', 'utf-8');

			await expect(
				saveChannelsConfig(testDir, {
					'max-message-length': {
						type: 'telegram',
						credential: 'secret:max-message-length-channel',
					},
				}),
			).rejects.toThrow('conflicts with an existing scalar setting');
			expect((await loadChannelsConfig(testDir)).settings.maxMessageLength).toBe(5000);
		});

		it('should preserve datetime scalars and reject same-named channel mutations', async () => {
			const filePath = join(testDir, 'channels.toml');
			await writeFile(filePath, 'future-setting = 1979-05-27T07:32:00Z\n', 'utf-8');

			await saveChannelsConfig(testDir, {}, ['future-setting']);
			const settingAfterRemoval = (await readTomlTableMap<unknown>(filePath))['future-setting'];
			expect(settingAfterRemoval).toBeInstanceOf(Date);
			expect((settingAfterRemoval as Date).toISOString()).toBe('1979-05-27T07:32:00.000Z');

			await expect(
				saveChannelsConfig(testDir, {
					'future-setting': {
						type: 'telegram',
						credential: 'secret:future-setting-channel',
					},
				}),
			).rejects.toThrow('conflicts with an existing scalar setting');
			const settingAfterCollision = (await readTomlTableMap<unknown>(filePath))['future-setting'];
			expect(settingAfterCollision).toBeInstanceOf(Date);
			expect((settingAfterCollision as Date).toISOString()).toBe('1979-05-27T07:32:00.000Z');
		});

		it('should round-trip __proto__ as an exact channel identifier', async () => {
			await saveChannelsConfig(
				testDir,
				Object.fromEntries([
					[
						'__proto__',
						{
							type: 'telegram',
							credential: 'secret:prototype-channel-credential',
							allowedUserIds: ['123456789'],
						},
					],
				]),
			);

			const { channels } = await loadChannelsConfig(testDir);
			expect(Object.hasOwn(channels, '__proto__')).toBe(true);
			expect(Reflect.get(channels, '__proto__')).toEqual({
				type: 'telegram',
				credential: 'secret:prototype-channel-credential',
				allowedUserIds: ['123456789'],
			});
		});
	});

	describe('saveModelsConfig', () => {
		it('should save models to models.toml', async () => {
			await saveModelsConfig(testDir, {
				'claude-opus': {
					provider: 'zai',
					modelId: 'claude-opus-4-20250514',
					thinkingLevel: 'medium',
				},
			});

			const content = await readFile(join(testDir, 'models.toml'), 'utf-8');
			expect(content).toContain('[claude-opus]');
			expect(content).toContain('provider = "zai"');
			expect(content).toContain('model-id = "claude-opus-4-20250514"');
			expect(content).toContain('thinking-level = "medium"');
		});

		it('should round-trip a case-sensitive model identifier verbatim', async () => {
			await saveModelsConfig(testDir, {
				autoAgent: {
					provider: 'myProvider',
					modelId: 'auto-agent',
				},
			});

			const models = await loadModelsConfig(testDir);
			expect(models.autoAgent).toEqual({
				provider: 'myProvider',
				modelId: 'auto-agent',
			});
			expect(models['auto-agent']).toBeUndefined();
		});

		it('should round-trip __proto__ as an exact model identifier', async () => {
			await saveModelsConfig(
				testDir,
				Object.fromEntries([
					[
						'__proto__',
						{
							provider: 'omniroute',
							modelId: 'auto-agent',
						},
					],
				]),
			);

			const models = await loadModelsConfig(testDir);
			expect(Object.hasOwn(models, '__proto__')).toBe(true);
			expect(Reflect.get(models, '__proto__')).toEqual({
				provider: 'omniroute',
				modelId: 'auto-agent',
			});
		});
	});
});
