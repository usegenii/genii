import type { Model } from '@mariozechner/pi-ai';
import { describe, expect, it } from 'vitest';
import type { GuidanceContext } from '../../guidance/types';
import type { AgentCheckpoint } from '../../snapshot/types';
import { createPiAdapter } from './adapter';

interface PiAgentState {
	onPayload?: (payload: unknown) => unknown;
	state: {
		thinkingLevel: string;
		model: Model<'google-generative-ai'>;
	};
}

describe('PiAgentAdapter', () => {
	it('uses Gemini 3.6 metadata and sends minimum hidden thinking to Pi', async () => {
		const adapter = createPiAdapter({
			providerType: 'google',
			userProviderName: 'google',
			userModelName: 'gemini-3.6-flash',
			modelId: 'gemini-3.6-flash',
			apiKey: 'test-api-key',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			thinkingLevel: 'off',
		});

		const instance = await adapter.create({
			guidance: {} as GuidanceContext,
			contextInjection: { systemContext: 'Test system context' },
			input: { message: 'Hello' },
		});
		const piAgent = Reflect.get(instance, 'agent') as PiAgentState;

		expect(piAgent.state.thinkingLevel).toBe('off');
		expect(piAgent.state.model).toMatchObject({
			id: 'gemini-3.6-flash',
			name: 'Gemini 3.6 Flash',
			api: 'google-generative-ai',
			provider: 'custom:google',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			reasoning: true,
			cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65536,
		});

		let requestPayload: unknown;
		piAgent.onPayload = (payload) => {
			requestPayload = payload;
			throw new Error('google-payload-captured');
		};

		const eventTypes: string[] = [];
		for await (const event of instance.run()) {
			eventTypes.push(event.type);
		}

		expect(eventTypes).toContain('error');
		expect(requestPayload).toMatchObject({
			model: 'gemini-3.6-flash',
			config: {
				maxOutputTokens: 32000,
				thinkingConfig: { thinkingLevel: 'MINIMAL' },
			},
		});
		const requestConfig = (requestPayload as { config: Record<string, unknown> }).config;
		expect(requestConfig).not.toHaveProperty('temperature');
		expect(requestConfig).not.toHaveProperty('topP');
		expect(requestConfig).not.toHaveProperty('topK');
		expect(requestConfig).not.toHaveProperty('candidateCount');
	});

	it('keeps generic custom metadata and disables thinking for unknown Google model IDs', async () => {
		const adapter = createPiAdapter({
			providerType: 'google',
			userProviderName: 'google-proxy',
			userModelName: 'experimental-gemini',
			modelId: 'experimental-gemini',
			apiKey: 'test-api-key',
			baseUrl: 'https://google.example.com/v1beta',
			thinkingLevel: 'off',
		});

		const instance = await adapter.create({
			guidance: {} as GuidanceContext,
			contextInjection: { systemContext: 'Test system context' },
			input: { message: 'Hello' },
		});
		const piAgent = Reflect.get(instance, 'agent') as PiAgentState;

		expect(piAgent.state.model).toMatchObject({
			id: 'experimental-gemini',
			api: 'google-generative-ai',
			provider: 'custom:google-proxy',
			baseUrl: 'https://google.example.com/v1beta',
			reasoning: true,
			contextWindow: 200000,
			maxTokens: 8192,
		});

		let requestPayload: unknown;
		piAgent.onPayload = (payload) => {
			requestPayload = payload;
			throw new Error('google-payload-captured');
		};

		for await (const event of instance.run()) {
			if (event.type === 'error') break;
		}

		expect(requestPayload).toMatchObject({
			model: 'experimental-gemini',
			config: {
				maxOutputTokens: 8192,
				thinkingConfig: { thinkingBudget: 0 },
			},
		});
	});

	it('replays Gemini 3.6 tool calls with matching IDs and thought signatures', async () => {
		const adapter = createPiAdapter({
			providerType: 'google',
			userProviderName: 'google',
			userModelName: 'gemini-3.6-flash',
			modelId: 'gemini-3.6-flash',
			apiKey: 'test-api-key',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			thinkingLevel: 'off',
		});
		const thoughtSignature = 'c2lnbmF0dXJl';
		const checkpoint = {
			adapterName: 'pi',
			session: {
				id: 'agent-session-test',
				createdAt: 1,
				metrics: { turns: 1 },
			},
			messages: [
				{ role: 'user', content: [{ type: 'text', text: 'Look it up' }], timestamp: 1 },
				{
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							id: 'call_123',
							name: 'lookup',
							input: { query: 'Genii' },
							thoughtSignature,
						},
					],
					timestamp: 2,
					api: 'google-generative-ai',
					provider: 'custom:google',
					model: 'gemini-3.6-flash',
				},
				{
					role: 'tool_result',
					content: [{ type: 'text', text: 'Found it' }],
					timestamp: 3,
					toolCallId: 'call_123',
					toolName: 'lookup',
					isError: false,
				},
			],
			adapterConfig: { provider: 'google', model: 'gemini-3.6-flash', thinkingLevel: 'off' },
		} as unknown as AgentCheckpoint;

		const instance = await adapter.restore(checkpoint, {
			guidance: {} as GuidanceContext,
			contextInjection: { systemContext: 'Test system context' },
			input: { message: 'Continue' },
		});
		const piAgent = Reflect.get(instance, 'agent') as PiAgentState;
		let requestPayload: unknown;
		piAgent.onPayload = (payload) => {
			requestPayload = payload;
			throw new Error('google-payload-captured');
		};

		for await (const event of instance.run()) {
			if (event.type === 'error') break;
		}

		expect(requestPayload).toMatchObject({
			model: 'gemini-3.6-flash',
			contents: expect.arrayContaining([
				{
					role: 'model',
					parts: [
						{
							functionCall: { id: 'call_123', name: 'lookup', args: { query: 'Genii' } },
							thoughtSignature,
						},
					],
				},
				{
					role: 'user',
					parts: [
						{
							functionResponse: {
								id: 'call_123',
								name: 'lookup',
								response: { output: 'Found it' },
							},
						},
					],
				},
			]),
		});
	});
});
