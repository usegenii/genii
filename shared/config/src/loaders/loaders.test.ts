import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadChannelsConfig } from './channels.js';
import { loadModelsConfig } from './models.js';
import { loadPreferencesConfig } from './preferences.js';
import { loadProvidersConfig } from './providers.js';
import { readTomlFile, readTomlFileOptional } from './toml.js';

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

	describe('loadProvidersConfig', () => {
		it('loads and parses providers.toml', async () => {
			const providersDir = path.join(tempDir, 'providers-test');
			await mkdir(providersDir, { recursive: true });

			const tomlContent = `
[anthropic]
type = "anthropic"
base-url = "https://api.anthropic.com"
credential = "secret:anthropic-api-key"

[openai]
type = "openai"
base-url = "https://api.openai.com"
credential = "secret:openai-api-key"
`;
			await writeFile(path.join(providersDir, 'providers.toml'), tomlContent, 'utf-8');

			const result = await loadProvidersConfig(providersDir);

			expect(result.anthropic).toBeDefined();
			expect(result.anthropic.type).toBe('anthropic');
			expect(result.anthropic.baseUrl).toBe('https://api.anthropic.com');
			expect(result.anthropic.credential).toBe('secret:anthropic-api-key');

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
	});

	describe('loadModelsConfig', () => {
		it('loads and parses models.toml', async () => {
			const modelsDir = path.join(tempDir, 'models-test');
			await mkdir(modelsDir, { recursive: true });

			const tomlContent = `
[claude-opus]
provider = "anthropic"
model-id = "claude-opus-4-5-20251101"

[gpt-4]
provider = "openai"
model-id = "gpt-4-turbo"
`;
			await writeFile(path.join(modelsDir, 'models.toml'), tomlContent, 'utf-8');

			const result = await loadModelsConfig(modelsDir);

			// Section names are also transformed to camelCase
			expect(result['claudeOpus']).toBeDefined();
			expect(result['claudeOpus'].provider).toBe('anthropic');
			expect(result['claudeOpus'].modelId).toBe('claude-opus-4-5-20251101');

			// gpt-4 stays as gpt-4 because the regex only transforms -[a-z]
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

			// Section names are also transformed to camelCase
			expect(result.channels['telegramPersonal']).toBeDefined();
			expect(result.channels['telegramPersonal'].type).toBe('telegram');
			expect(result.channels['telegramPersonal'].credential).toBe('secret:telegram-bot-token');

			expect(result.channels['discordServer']).toBeDefined();
			expect(result.channels['discordServer'].type).toBe('discord');
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
