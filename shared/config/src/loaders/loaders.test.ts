import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadChannelsConfig } from './channels.js';
import { loadModelsConfig } from './models.js';
import { loadPreferencesConfig } from './preferences.js';
import { loadProvidersConfig } from './providers.js';
import { readTomlFile, readTomlFileOptional, readTomlTableMapOptional } from './toml.js';

describe('TOML Loaders', () => {
	let tempDir: string;

	beforeAll(async () => {
		tempDir = path.join(tmpdir(), `toml-loaders-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
	});

	afterAll(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe('readTomlFile', () => {
		it('parses TOML and transforms keys to camelCase', async () => {
			const tomlContent = `
[some-section]
kebab-case-key = "value1"
another-key = 42
nested-object = { inner-key = "nested-value" }
`;
			const filePath = path.join(tempDir, 'camelcase-test.toml');
			await writeFile(filePath, tomlContent, 'utf-8');

			const result = await readTomlFile<{
				someSection: {
					kebabCaseKey: string;
					anotherKey: number;
					nestedObject: { innerKey: string };
				};
			}>(filePath);

			expect(result.someSection).toBeDefined();
			expect(result.someSection.kebabCaseKey).toBe('value1');
			expect(result.someSection.anotherKey).toBe(42);
			expect(result.someSection.nestedObject.innerKey).toBe('nested-value');
		});

		it('throws for non-existent file', async () => {
			const filePath = path.join(tempDir, 'does-not-exist.toml');
			await expect(readTomlFile(filePath)).rejects.toThrow();
		});
	});

	describe('readTomlFileOptional', () => {
		it('returns undefined for non-existent file', async () => {
			const filePath = path.join(tempDir, 'missing-optional.toml');
			const result = await readTomlFileOptional(filePath);
			expect(result).toBeUndefined();
		});

		it('parses existing file correctly', async () => {
			const tomlContent = `key-name = "test-value"`;
			const filePath = path.join(tempDir, 'optional-exists.toml');
			await writeFile(filePath, tomlContent, 'utf-8');

			const result = await readTomlFileOptional<{ keyName: string }>(filePath);
			expect(result).toBeDefined();
			expect(result?.keyName).toBe('test-value');
		});
	});

	describe('readTomlTableMapOptional', () => {
		it('reads identifier-keyed table maps without normalizing their identifiers', async () => {
			const tomlContent = `
[user-defined-table]
schema-field = "test-value"

["__proto__"]
schema-field = "prototype-value"
`;
			const filePath = path.join(tempDir, 'preserve-top-level.toml');
			await writeFile(filePath, tomlContent, 'utf-8');

			const result = await readTomlTableMapOptional<{ schemaField: string }>(filePath);

			expect(result?.['user-defined-table']).toEqual({ schemaField: 'test-value' });
			expect(result?.userDefinedTable).toBeUndefined();
			expect(Object.hasOwn(result ?? {}, '__proto__')).toBe(true);
			expect(Reflect.get(result ?? {}, '__proto__')).toEqual({ schemaField: 'prototype-value' });
		});
	});

	describe('loadProvidersConfig', () => {
		it('loads and parses providers.toml', async () => {
			const providersDir = path.join(tempDir, 'providers-test');
			await mkdir(providersDir, { recursive: true });

			const tomlContent = `
[custom-provider]
type = "anthropic"
base-url = "https://api.example.com"
credential = "secret:custom-provider-api-key"

[openai]
type = "openai"
base-url = "https://api.openai.com"
credential = "secret:openai-api-key"
`;
			await writeFile(path.join(providersDir, 'providers.toml'), tomlContent, 'utf-8');

			const result = await loadProvidersConfig(providersDir);

			expect(result['custom-provider']).toEqual({
				type: 'anthropic',
				baseUrl: 'https://api.example.com',
				credential: 'secret:custom-provider-api-key',
			});
			expect(result.customProvider).toBeUndefined();

			expect(result.openai).toBeDefined();
			expect(result.openai.type).toBe('openai');
			expect(result.openai.baseUrl).toBe('https://api.openai.com');
		});

		it('returns empty object for missing file', async () => {
			const emptyDir = path.join(tempDir, 'providers-empty');
			await mkdir(emptyDir, { recursive: true });

			const result = await loadProvidersConfig(emptyDir);
			expect(result).toEqual({});
		});

		it('accepts Google providers and preserves opaque identifiers and direct credentials', async () => {
			const providersDir = path.join(tempDir, 'providers-google');
			await mkdir(providersDir, { recursive: true });

			const tomlContent = `
[google]
type = "google"
base-url = "https://generativelanguage.googleapis.com/v1beta"
credential = "direct-test-key"

["__proto__"]
type = "openai"
base-url = "https://api.example.com/v1"
credential = "secret:prototype-api-key"
experimental-option = true
`;
			await writeFile(path.join(providersDir, 'providers.toml'), tomlContent, 'utf-8');

			const result = await loadProvidersConfig(providersDir);

			expect(result.google).toMatchObject({
				type: 'google',
				baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
				credential: 'direct-test-key',
			});
			expect(Object.hasOwn(result, '__proto__')).toBe(true);
			expect(Reflect.get(result, '__proto__')).toMatchObject({
				type: 'openai',
				baseUrl: 'https://api.example.com/v1',
				credential: 'secret:prototype-api-key',
				experimentalOption: true,
			});
		});

		it('rejects unsupported provider API types with the provider identifier', async () => {
			const providersDir = path.join(tempDir, 'providers-unsupported');
			await mkdir(providersDir, { recursive: true });

			const tomlContent = `
[vertex]
type = "google-vertex"
base-url = "https://us-central1-aiplatform.googleapis.com"
credential = "secret:vertex-api-key"
`;
			await writeFile(path.join(providersDir, 'providers.toml'), tomlContent, 'utf-8');

			await expect(loadProvidersConfig(providersDir)).rejects.toThrow(
				'Provider "vertex" has unsupported API type "google-vertex". Supported types: anthropic, openai, google',
			);
		});
	});

	describe('loadModelsConfig', () => {
		it('loads and parses models.toml', async () => {
			const modelsDir = path.join(tempDir, 'models-test');
			await mkdir(modelsDir, { recursive: true });

			const tomlContent = `
[auto-agent]
provider = "omniroute"
model-id = "auto-agent"
thinking-level = "high"

[gpt-4]
provider = "openai"
model-id = "gpt-4-turbo"
`;
			await writeFile(path.join(modelsDir, 'models.toml'), tomlContent, 'utf-8');

			const result = await loadModelsConfig(modelsDir);

			expect(result['auto-agent']).toEqual({
				provider: 'omniroute',
				modelId: 'auto-agent',
				thinkingLevel: 'high',
			});
			expect(result.autoAgent).toBeUndefined();

			expect(result['gpt-4']).toBeDefined();
			expect(result['gpt-4'].provider).toBe('openai');
			expect(result['gpt-4'].modelId).toBe('gpt-4-turbo');
		});

		it('returns empty object for missing file', async () => {
			const emptyDir = path.join(tempDir, 'models-empty');
			await mkdir(emptyDir, { recursive: true });

			const result = await loadModelsConfig(emptyDir);
			expect(result).toEqual({});
		});
	});

	describe('loadChannelsConfig', () => {
		it('loads settings and channels', async () => {
			const channelsDir = path.join(tempDir, 'channels-test');
			await mkdir(channelsDir, { recursive: true });

			const tomlContent = `
max-message-length = 5000
rate-limit-per-minute = 120

[telegram-personal]
type = "telegram"
credential = "secret:telegram-bot-token"
allowed-user-ids = ["123456789"]
polling-interval-ms = 1000

[discord-server]
type = "discord"
credential = "secret:discord-bot-token"
`;
			await writeFile(path.join(channelsDir, 'channels.toml'), tomlContent, 'utf-8');

			const result = await loadChannelsConfig(channelsDir);

			expect(result.settings.maxMessageLength).toBe(5000);
			expect(result.settings.rateLimitPerMinute).toBe(120);

			expect(result.channels['telegram-personal']).toEqual({
				type: 'telegram',
				credential: 'secret:telegram-bot-token',
				allowedUserIds: ['123456789'],
				pollingIntervalMs: 1000,
			});
			expect(result.channels.telegramPersonal).toBeUndefined();

			expect(result.channels['discord-server']).toBeDefined();
			expect(result.channels['discord-server'].type).toBe('discord');
		});

		it('returns defaults for missing file', async () => {
			const emptyDir = path.join(tempDir, 'channels-empty');
			await mkdir(emptyDir, { recursive: true });

			const result = await loadChannelsConfig(emptyDir);

			expect(result.settings.maxMessageLength).toBe(4000);
			expect(result.settings.rateLimitPerMinute).toBe(60);
			expect(result.channels).toEqual({});
		});

		it('uses default settings when not specified in file', async () => {
			const channelsDir = path.join(tempDir, 'channels-partial');
			await mkdir(channelsDir, { recursive: true });

			const tomlContent = `
[telegram]
type = "telegram"
credential = "secret:token"
`;
			await writeFile(path.join(channelsDir, 'channels.toml'), tomlContent, 'utf-8');

			const result = await loadChannelsConfig(channelsDir);

			expect(result.settings.maxMessageLength).toBe(4000);
			expect(result.settings.rateLimitPerMinute).toBe(60);
			expect(result.channels.telegram).toBeDefined();
		});
	});

	describe('loadPreferencesConfig', () => {
		it('loads preferences', async () => {
			const prefsDir = path.join(tempDir, 'preferences-test');
			await mkdir(prefsDir, { recursive: true });

			const tomlContent = `
[agents]
default-models = ["claude-opus", "gpt-4"]

[logging]
level = "debug"
`;
			await writeFile(path.join(prefsDir, 'preferences.toml'), tomlContent, 'utf-8');

			const result = await loadPreferencesConfig(prefsDir);

			expect(result.agents.defaultModels).toEqual(['claude-opus', 'gpt-4']);
			expect(result.logging.level).toBe('debug');
		});

		it('returns defaults for missing file', async () => {
			const emptyDir = path.join(tempDir, 'preferences-empty');
			await mkdir(emptyDir, { recursive: true });

			const result = await loadPreferencesConfig(emptyDir);

			expect(result.agents.defaultModels).toEqual([]);
			expect(result.logging.level).toBe('info');
		});
	});
});
