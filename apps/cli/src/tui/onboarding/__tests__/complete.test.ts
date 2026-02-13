/**
 * Unit tests for onboarding completion handler.
 */

import { describe, expect, it, vi } from 'vitest';
import { completeOnboarding } from '../complete';
import type { OnboardingState } from '../types';
import { DEFAULT_STATE } from '../types';

// Mock all external side effects
vi.mock('@genii/config/secrets/composite', () => ({
	createSecretStore: vi.fn().mockResolvedValue({
		set: vi.fn().mockResolvedValue({ success: true }),
	}),
}));

vi.mock('../../../client', () => ({
	createDaemonClient: vi.fn().mockReturnValue({
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		onboardExecute: vi.fn().mockResolvedValue({ copied: [], backedUp: [], skipped: [] }),
	}),
}));

vi.mock('@genii/config/writers/providers', () => ({
	saveProvidersConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@genii/config/writers/toml', () => ({
	writeTomlFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@genii/config/loaders/toml', () => ({
	readTomlFileOptional: vi.fn().mockResolvedValue({}),
}));

vi.mock('@genii/config/writers/preferences', () => ({
	savePreferencesConfig: vi.fn().mockResolvedValue(undefined),
}));

import { savePreferencesConfig } from '@genii/config/writers/preferences';

const mockSavePreferencesConfig = vi.mocked(savePreferencesConfig);

describe('completeOnboarding', () => {
	it('should prefix defaultModels with provider ID', async () => {
		const state: OnboardingState = {
			...DEFAULT_STATE,
			disclaimerAccepted: true,
			providers: [
				{
					id: 'zai',
					type: 'builtin',
					builtinId: 'zai',
					apiKey: 'sk-test-key',
					selectedModels: ['glm-4.7'],
				},
			],
		};

		const result = await completeOnboarding(state, '/tmp/fake/guidance');
		expect(result.success).toBe(true);

		expect(mockSavePreferencesConfig).toHaveBeenCalledWith(
			'/tmp/fake',
			expect.objectContaining({
				defaultModels: ['zai/glm-4.7'],
			}),
		);
	});

	it('should prefix defaultModels with correct provider for multiple providers', async () => {
		const state: OnboardingState = {
			...DEFAULT_STATE,
			disclaimerAccepted: true,
			providers: [
				{
					id: 'zai',
					type: 'builtin',
					builtinId: 'zai',
					apiKey: 'sk-test-key-1',
					selectedModels: ['glm-4.7'],
				},
				{
					id: 'my-custom',
					type: 'custom',
					custom: {
						apiType: 'openai',
						baseUrl: 'https://api.example.com/v1',
						apiKey: 'sk-test-key-2',
					},
					selectedModels: ['custom-model-1', 'custom-model-2'],
				},
			],
		};

		const result = await completeOnboarding(state, '/tmp/fake/guidance');
		expect(result.success).toBe(true);

		expect(mockSavePreferencesConfig).toHaveBeenCalledWith(
			'/tmp/fake',
			expect.objectContaining({
				defaultModels: ['zai/glm-4.7', 'my-custom/custom-model-1', 'my-custom/custom-model-2'],
			}),
		);
	});
});
