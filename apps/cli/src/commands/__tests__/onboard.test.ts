/**
 * Integration tests for the onboard command.
 */

import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Note: Since the onboard command integrates with the daemon RPC,
// we'll test the individual components that make up the non-interactive mode

import { loadPreferencesConfig } from '@genii/config/loaders/preferences';
import { BUILTIN_PROVIDERS, getProvider } from '@genii/config/providers/definitions';
import { FileSecretStore } from '@genii/config/secrets/file';
import { saveModelsConfig } from '@genii/config/writers/models';
import { savePreferencesConfig } from '@genii/config/writers/preferences';
import { saveProvidersConfig } from '@genii/config/writers/providers';
import { createShellTool } from '@genii/orchestrator/tools/shell/tool';
import type { ToolContext } from '@genii/orchestrator/tools/types';
import { buildNonInteractivePreferences } from '../onboard';

describe('Onboard Command Integration', () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `genii-onboard-test-${Date.now()}`);
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
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
			const secretStore = new FileSecretStore(join(testDir, 'secrets.json'));
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
			expect(providersContent).toContain('type = "openai"');
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
			const preferences = buildNonInteractivePreferences(providerId, modelIds);
			expect(preferences).toEqual({
				logLevel: 'info',
				shellTimeout: 30_000,
				defaultModels: ['zai/claude-opus-4-20250514', 'zai/claude-sonnet-4-20250514'],
			});
			await savePreferencesConfig(testDir, preferences);

			// Verify preferences.toml
			const prefsContent = await readFile(join(testDir, 'preferences.toml'), 'utf-8');
			expect(prefsContent).toContain('[logging]');
			expect(prefsContent).toContain('level = "info"');
			expect(prefsContent).toContain('[agents.tools.shell]');
			expect(prefsContent).toContain('default-timeout = 30000');

			// Exercise the real shell tool without a per-command timeout override.
			const loadedPreferences = await loadPreferencesConfig(testDir);
			const shellPreferences = loadedPreferences.agents.tools?.shell;
			expect(shellPreferences?.defaultTimeout).toBe(30_000);

			if (shellPreferences?.defaultTimeout === undefined) {
				throw new Error('Fresh onboarding preferences did not contain a shell timeout');
			}

			vi.stubEnv('SHELL', '/bin/sh');
			const shellTool = createShellTool({
				defaultWorkingDir: testDir,
				defaultTimeout: shellPreferences.defaultTimeout,
				maxOutputLength: shellPreferences.maxOutputLength ?? 50_000,
			});
			const shellResult = await shellTool.execute(
				{ command: 'sleep 0.1 && printf GENII_SHELL_OK' },
				createToolContext(),
			);

			expect(shellResult.status).toBe('success');
			if (shellResult.status === 'success') {
				expect(shellResult.output).toContain('GENII_SHELL_OK');
				expect(shellResult.output).toContain('<exit-code>0</exit-code>');
				expect(shellResult.output).not.toContain('<timed-out>true</timed-out>');
			}
		});

		it('should retrieve stored API key from secret store', async () => {
			const secretStore = new FileSecretStore(join(testDir, 'secrets.json'));
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
			expect(zaiProvider?.apiType).toBe('openai');
		});
	});
});

function createToolContext(): ToolContext {
	return {
		sessionId: 'fresh-onboarding-shell-timeout-test',
		guidance: {} as ToolContext['guidance'],
		signal: new AbortController().signal,
		step: {} as ToolContext['step'],
		emitProgress: vi.fn(),
		log: vi.fn(),
	};
}
