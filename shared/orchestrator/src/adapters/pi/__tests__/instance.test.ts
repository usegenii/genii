import type { StreamFn } from '@mariozechner/pi-agent-core';
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	EventStream,
	type Model,
} from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../../../events/types';
import type { GuidanceContext } from '../../../guidance/types';
import type { InstanceCheckpoint } from '../../../snapshot/types';
import { createToolRegistryWith } from '../../../tools/registry';
import { createSuspensionId, normalizeSuspensionResolution } from '../../../tools/suspension';
import type { Tool } from '../../../tools/types';
import type { AgentSessionId } from '../../../types/core';
import { PiAgentInstance } from '../instance';

function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function assistantMessage(
	content: AssistantMessage['content'],
	stopReason: AssistantMessage['stopReason'],
): AssistantMessage {
	return {
		role: 'assistant',
		content,
		api: 'anthropic-messages',
		provider: 'anthropic',
		model: 'test-model',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function streamFor(message: AssistantMessage) {
	const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
		(event) => event.type === 'done' || event.type === 'error',
		(event) => (event.type === 'done' ? event.message : event.type === 'error' ? event.error : message),
	);
	queueMicrotask(() => {
		stream.push({ type: 'start', partial: message });
		if (message.stopReason === 'error' || message.stopReason === 'aborted') {
			stream.push({ type: 'error', reason: message.stopReason, error: message });
		} else {
			stream.push({ type: 'done', reason: message.stopReason, message });
		}
	});
	return stream;
}

const testModel: Model<'anthropic-messages'> = {
	id: 'test-model',
	name: 'test-model',
	api: 'anthropic-messages',
	provider: 'anthropic',
	baseUrl: 'https://example.invalid',
	reasoning: false,
	input: ['text'],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 1_000,
};

describe('PiAgentInstance durable suspension lifecycle', () => {
	it('persists before publishing, accepts a typed resolution, and replays without repeating a durable step', async () => {
		const sideEffect = vi.fn(async () => 'prepared');
		const persistEntered = createDeferred();
		const allowPersist = createDeferred();
		const checkpoints: Array<{ reason: string; checkpoint: InstanceCheckpoint }> = [];
		const tool: Tool<unknown, unknown> = {
			name: 'build',
			description: 'wait for build completion',
			parameters: Type.Object({}),
			canSuspend: true,
			execute: async (_input, context) => {
				const prepared = await context.step.run('prepare', sideEffect);
				const event = await context.step.waitForEvent('build.finished');
				return { status: 'success', output: { prepared, event } };
			},
		};
		let modelCalls = 0;
		const streamFn: StreamFn = (_model, context: Context) => {
			modelCalls++;
			if (modelCalls === 1) {
				return streamFor(
					assistantMessage([{ type: 'toolCall', id: 'call-1', name: 'build', arguments: {} }], 'toolUse'),
				);
			}
			expect(context.messages.at(-1)?.role).toBe('toolResult');
			return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
		};
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (checkpoint, reason) => {
					if (reason === 'suspended') {
						persistEntered.resolve();
						await allowPersist.promise;
					}
					checkpoints.push({ reason, checkpoint: structuredClone(checkpoint) });
				},
			},
			testModel,
			'',
			{ streamFn },
		);
		const events: AgentEvent[] = [];
		const run = (async () => {
			for await (const event of instance.run()) events.push(event);
		})();

		await persistEntered.promise;
		expect(events.some((event) => event.type === 'suspended')).toBe(false);
		allowPersist.resolve();
		await vi.waitFor(() => expect(instance.getPendingRequests()).toHaveLength(1));

		const [pending] = instance.getPendingRequests();
		if (!pending) throw new Error('Expected a pending request');
		expect(pending.stepId).toBe('__suspension:event:build.finished:0');
		await instance.resolve([{ suspensionId: pending.suspensionId, type: 'event', payload: null }]);
		await run;

		expect(checkpoints.map(({ reason }) => reason)).toEqual(['suspended', 'resolution_accepted', 'tool_completed']);
		expect(checkpoints[0]?.checkpoint.toolExecutions[0]?.suspendedStep?.status).toBe('waiting');
		expect(checkpoints[1]?.checkpoint.toolExecutions[0]?.suspendedStep?.status).toBe('resolved');
		expect(checkpoints[2]?.checkpoint.toolExecutions).toEqual([]);
		expect(checkpoints[2]?.checkpoint.messages.filter((message) => message.role === 'tool_result')).toHaveLength(1);
		expect(sideEffect).toHaveBeenCalledTimes(1);
		expect(modelCalls).toBe(2);
		expect(events.some((event) => event.type === 'done')).toBe(true);
	});

	it('fails visibly without publishing a suspension when its checkpoint cannot be saved', async () => {
		const tool: Tool<unknown, unknown> = {
			name: 'wait',
			description: 'wait for an event',
			parameters: Type.Object({}),
			canSuspend: true,
			execute: async (_input, context) => {
				await context.step.waitForEvent('never');
				return { status: 'success', output: 'unreachable' };
			},
		};
		let modelCalls = 0;
		const streamFn: StreamFn = () => {
			modelCalls++;
			return modelCalls === 1
				? streamFor(
						assistantMessage([{ type: 'toolCall', id: 'call-1', name: 'wait', arguments: {} }], 'toolUse'),
					)
				: streamFor(assistantMessage([{ type: 'text', text: 'should be ignored' }], 'stop'));
		};
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async () => {
					throw new Error('snapshot unavailable');
				},
			},
			testModel,
			'',
			{ streamFn },
		);
		const events: AgentEvent[] = [];

		for await (const event of instance.run()) events.push(event);

		expect(events.some((event) => event.type === 'suspended')).toBe(false);
		expect(events).toContainEqual(
			expect.objectContaining({ type: 'error', error: 'snapshot unavailable', fatal: true }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ type: 'done', result: expect.objectContaining({ status: 'failed' }) }),
		);
		expect(instance.status()).toBe('failed');
	});

	it('retains the resolved invocation and parks Pi when tool-result persistence fails', async () => {
		const tool: Tool<unknown, unknown> = {
			name: 'wait',
			description: 'wait for an event',
			parameters: Type.Object({}),
			canSuspend: true,
			execute: async (_input, context) => {
				const payload = await context.step.waitForEvent('event');
				return { status: 'success', output: payload };
			},
		};
		let modelCalls = 0;
		let failToolCompletion = true;
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (_checkpoint, reason) => {
					if (reason === 'tool_completed' && failToolCompletion) throw new Error('tool result save failed');
				},
			},
			testModel,
			'',
			{
				streamFn: () => {
					modelCalls++;
					return modelCalls === 1
						? streamFor(
								assistantMessage(
									[{ type: 'toolCall', id: 'call-1', name: 'wait', arguments: {} }],
									'toolUse',
								),
							)
						: streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
			},
		);
		const events: AgentEvent[] = [];
		const run = (async () => {
			for await (const event of instance.run()) events.push(event);
		})();
		await vi.waitFor(() => expect(instance.getPendingRequests()).toHaveLength(1));
		const [pending] = instance.getPendingRequests();
		if (!pending) throw new Error('Expected pending request');

		await instance.resolve([{ suspensionId: pending.suspensionId, type: 'event', payload: false }]);
		await run;

		expect(events).toContainEqual(
			expect.objectContaining({ type: 'error', error: 'tool result save failed', fatal: true }),
		);
		expect(instance.getPendingRequests()[0]?.status).toBe('resolved');
		const retryCheckpoint = await instance.checkpoint();
		expect(retryCheckpoint.toolExecutions).toHaveLength(1);
		expect(retryCheckpoint.messages.filter((message) => message.role === 'tool_result')).toHaveLength(0);
		expect(modelCalls).toBe(1);

		failToolCompletion = false;
		for await (const _event of instance.run()) {
			// Retry the retained invocation in the same warm instance.
		}
		const completedCheckpoint = await instance.checkpoint();
		expect(instance.getPendingRequests()).toEqual([]);
		expect(completedCheckpoint.toolExecutions).toEqual([]);
		expect(completedCheckpoint.messages.filter((message) => message.role === 'tool_result')).toHaveLength(1);
		expect(modelCalls).toBe(2);
	});

	it('rejects wrong and conflicting resolutions while identical retries remain idempotent', async () => {
		const finishReplay = createDeferred();
		const tool: Tool<unknown, unknown> = {
			name: 'wait',
			description: 'wait for an event',
			parameters: Type.Object({}),
			canSuspend: true,
			execute: async (_input, context) => {
				const payload = await context.step.waitForEvent('event');
				await finishReplay.promise;
				return { status: 'success', output: payload };
			},
		};
		let modelCalls = 0;
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async () => {},
			},
			testModel,
			'',
			{
				streamFn: () => {
					modelCalls++;
					return modelCalls === 1
						? streamFor(
								assistantMessage(
									[{ type: 'toolCall', id: 'call-1', name: 'wait', arguments: {} }],
									'toolUse',
								),
							)
						: streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
			},
		);
		const events: AgentEvent[] = [];
		const run = (async () => {
			for await (const event of instance.run()) events.push(event);
		})();
		await vi.waitFor(() => expect(instance.getPendingRequests()).toHaveLength(1));
		const [pending] = instance.getPendingRequests();
		if (!pending) throw new Error('Expected pending request');

		await expect(
			instance.resolve([{ suspensionId: pending.suspensionId, type: 'approval', approved: false }]),
		).rejects.toThrow('does not match suspension type');
		expect(instance.getPendingRequests()[0]?.status).toBe('waiting');

		const accepted = { suspensionId: pending.suspensionId, type: 'event' as const, payload: false };
		await instance.resolve([accepted]);
		await expect(instance.resolve([accepted])).resolves.toBeUndefined();
		await expect(
			instance.resolve([{ suspensionId: pending.suspensionId, type: 'event', payload: true }]),
		).rejects.toThrow('conflicting resolution');
		expect(instance.getPendingRequests()[0]?.status).toBe('resolved');
		expect(events).toContainEqual(expect.objectContaining({ type: 'status', status: 'running' }));

		finishReplay.resolve();
		await run;
	});

	it('rehydrates an accepted resolution, appends one tool result, and continues without a user message', async () => {
		const sideEffect = vi.fn(async () => 'must-not-run');
		const request = { type: 'event' as const, eventName: 'build.finished' };
		const stepId = '__suspension:event:build.finished:0';
		const suspensionId = createSuspensionId('call-1', stepId);
		const resolution = { suspensionId, type: 'event' as const, payload: null };
		const tool: Tool<unknown, unknown> = {
			name: 'build',
			description: 'replay a build wait',
			parameters: Type.Object({}),
			canSuspend: true,
			execute: async (_input, context) => {
				const prepared = await context.step.run('prepare', sideEffect);
				const payload = await context.step.waitForEvent('build.finished');
				return { status: 'success', output: { prepared, payload } };
			},
		};
		const assistant = assistantMessage(
			[{ type: 'toolCall', id: 'call-1', name: 'build', arguments: {} }],
			'toolUse',
		);
		const sessionId = 'session-restored' as AgentSessionId;
		const completed: InstanceCheckpoint[] = [];
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (checkpoint, reason) => {
					if (reason === 'tool_completed') completed.push(structuredClone(checkpoint));
				},
			},
			testModel,
			'',
			{
				streamFn: (_model, context) => {
					expect(context.messages.at(-1)?.role).toBe('toolResult');
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
				restoreOptions: {
					messages: [assistant],
					sessionId,
					createdAt: 123,
					turnCount: 1,
					provider: 'anthropic',
					modelId: 'test-model',
					toolExecutions: [
						{
							toolName: 'build',
							toolCallId: 'call-1',
							input: {},
							completedSteps: [{ stepId: 'prepare', result: 'prepared', completedAt: 100 }],
							suspendedStep: {
								suspensionId,
								stepId,
								request,
								suspendedAt: 101,
								status: 'resolved',
								resolution,
								resumeData: normalizeSuspensionResolution(stepId, request, resolution),
							},
						},
					],
				},
			},
		);

		for await (const _event of instance.run()) {
			// Drain the restored replay.
		}

		expect(instance.id).toBe(sessionId);
		expect(sideEffect).not.toHaveBeenCalled();
		expect(completed).toHaveLength(1);
		expect(completed[0]?.toolExecutions).toEqual([]);
		expect(completed[0]?.messages.filter((message) => message.role === 'tool_result')).toHaveLength(1);
	});
});
