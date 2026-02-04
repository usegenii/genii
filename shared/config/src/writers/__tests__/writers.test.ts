/**
 * Tests for config writers.
 */

import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveModelsConfig } from '../models.js';
import { savePreferencesConfig } from '../preferences.js';
import { saveProvidersConfig } from '../providers.js';
import { writeTomlFile } from '../toml.js';

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

	describe('savePreferencesConfig', () => {
		it('should save preferences to preferences.toml', async () => {
			await savePreferencesConfig(testDir, {
				logLevel: 'info',
				shellTimeout: 30,
			});

			const content = await readFile(join(testDir, 'preferences.toml'), 'utf-8');
			expect(content).toContain('log-level = "info"');
			expect(content).toContain('shell-timeout = 30');
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
	});
});
