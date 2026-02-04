/**
 * Integration tests for the onboard command.
 */

import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Note: Since the onboard command integrates with the daemon RPC,
// we'll test the individual components that make up the non-interactive mode

import { BUILTIN_PROVIDERS, getProvider } from '@genii/config/providers/definitions';
import { createSecretStore } from '@genii/config/secrets/composite';
import { saveModelsConfig } from '@genii/config/writers/models';
import { savePreferencesConfig } from '@genii/config/writers/preferences';
import { saveProvidersConfig } from '@genii/config/writers/providers';

describe('Onboard Command Integration', () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `genii-onboard-test-${Date.now()}`);
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe('Non-interactive mode', () => {
		it('should write all config files for a valid setup', async () => {
			const providerId = 'zai';
			const apiKey = 'sk-test-key-12345';
			const modelIds = ['claude-opus-4-20250514', 'claude-sonnet-4-20250514'];

			// Get provider definition
			const providerDef = getProvider(providerId);
			expect(providerDef).toBeDefined();
			if (!providerDef) {
				throw new Error('Provider not found');
			}

			if (!providerDef.defaultBaseUrl) {
				throw new Error('Provider has no default base URL');
			}

			// Store API key in secret store
			const secretStore = await createSecretStore(testDir, 'genii');
			const secretName = `${providerId}-api-key`;
			const secretResult = await secretStore.set(secretName, apiKey);
			expect(secretResult.success).toBe(true);

			// Write provider config
			await saveProvidersConfig(testDir, {
				[providerId]: {
					type: providerDef.apiType,
					baseUrl: providerDef.defaultBaseUrl,
					credential: `secret:${secretName}`,
				},
			});

			// Verify providers.toml
			const providersContent = await readFile(join(testDir, 'providers.toml'), 'utf-8');
			expect(providersContent).toContain('[zai]');
			expect(providersContent).toContain('type = "anthropic"');
			expect(providersContent).toContain('credential = "secret:zai-api-key"');

			// Write models config
			const modelsConfig: Record<string, { provider: string; modelId: string }> = {};
			for (const modelId of modelIds) {
				modelsConfig[modelId] = {
					provider: providerId,
					modelId,
				};
			}
			await saveModelsConfig(testDir, modelsConfig);

			// Verify models.toml
			const modelsContent = await readFile(join(testDir, 'models.toml'), 'utf-8');
			expect(modelsContent).toContain('provider = "zai"');
			expect(modelsContent).toContain('model-id = "claude-opus-4-20250514"');

			// Write preferences config
			await savePreferencesConfig(testDir, {
				logLevel: 'info',
				shellTimeout: 30,
			});

			// Verify preferences.toml
			const prefsContent = await readFile(join(testDir, 'preferences.toml'), 'utf-8');
			expect(prefsContent).toContain('log-level = "info"');
			expect(prefsContent).toContain('shell-timeout = 30');
		});

		it('should retrieve stored API key from secret store', async () => {
			const secretStore = await createSecretStore(testDir, 'genii');
			const apiKey = 'sk-test-secret-key';

			// Store
			await secretStore.set('test-api-key', apiKey);

			// Retrieve
			const result = await secretStore.get('test-api-key');
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.value).toBe(apiKey);
			}
		});

		it('should include all built-in providers in definitions', () => {
			expect(BUILTIN_PROVIDERS.length).toBeGreaterThan(0);

			const zaiProvider = getProvider('zai');
			expect(zaiProvider).toBeDefined();
			expect(zaiProvider?.apiType).toBe('anthropic');
		});
	});
});
