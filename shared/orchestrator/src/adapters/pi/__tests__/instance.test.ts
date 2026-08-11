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
import { agentToolResultToPiMessage, checkpointToPiMessages } from '../messages';

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
		expect(instance.getPendingRequests()).toEqual([]);
		allowPersist.resolve();
		await vi.waitFor(() => expect(instance.getPendingRequests()).toHaveLength(1));

		const [pending] = instance.getPendingRequests();
		if (!pending) throw new Error('Expected a pending request');
		expect(pending.stepId).toBe('__suspension:event:build.finished:0');
		const waitingSnapshot = await instance.checkpoint();
		await instance.resolve([{ suspensionId: pending.suspensionId, type: 'event', payload: null }]);
		await run;

		expect(checkpoints.map(({ reason }) => reason)).toEqual(['suspended', 'resolution_accepted', 'tool_completed']);
		expect(checkpoints[0]?.checkpoint.toolExecutions[0]?.suspendedStep?.status).toBe('waiting');
		expect(checkpoints[1]?.checkpoint.toolExecutions[0]?.suspendedStep?.status).toBe('resolved');
		expect(checkpoints[2]?.checkpoint.toolExecutions).toMatchObject([
			{ toolCallId: 'call-1', suspendedStep: { status: 'resolved' }, result: { isError: false } },
		]);
		expect(checkpoints[2]?.checkpoint.messages.filter((message) => message.role === 'tool_result')).toHaveLength(1);
		expect(waitingSnapshot.toolExecutions[0]?.suspendedStep?.status).toBe('waiting');
		expect(waitingSnapshot.toolExecutions[0]?.result).toBeUndefined();
		expect((await instance.checkpoint()).toolExecutions).toEqual([]);
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

	it('re-persists and publishes a retained wait on a warm retry after its first save fails', async () => {
		let toolInvocations = 0;
		const tool: Tool<unknown, unknown> = {
			name: 'wait',
			description: 'wait for an event',
			parameters: Type.Object({}),
			canSuspend: true,
			execute: async (_input, context) => {
				toolInvocations++;
				const payload = await context.step.waitForEvent('retry');
				return { status: 'success', output: payload };
			},
		};
		let suspensionSaves = 0;
		let modelCalls = 0;
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (_checkpoint, reason) => {
					if (reason !== 'suspended') return;
					suspensionSaves++;
					if (suspensionSaves === 1) throw new Error('first suspension save failed');
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
		const firstEvents: AgentEvent[] = [];

		for await (const event of instance.run()) firstEvents.push(event);

		expect(firstEvents).toContainEqual(
			expect.objectContaining({ type: 'error', error: 'first suspension save failed', fatal: true }),
		);
		expect(instance.getPendingRequests()).toEqual([]);
		expect((await instance.checkpoint()).toolExecutions).toMatchObject([
			{ toolCallId: 'call-1', suspendedStep: { status: 'waiting' } },
		]);

		const retryEvents: AgentEvent[] = [];
		const retry = (async () => {
			for await (const event of instance.run()) retryEvents.push(event);
		})();
		await vi.waitFor(() => expect(suspensionSaves).toBe(2));
		await vi.waitFor(() => expect(instance.getPendingRequests()).toHaveLength(1));
		const [pending] = instance.getPendingRequests();
		if (!pending) throw new Error('Expected the retained wait after retry persistence');
		await instance.resolve([{ suspensionId: pending.suspensionId, type: 'event', payload: 'accepted' }]);
		await retry;

		expect(suspensionSaves).toBe(2);
		expect(toolInvocations).toBe(2);
		expect(modelCalls).toBe(2);
		expect(retryEvents).toContainEqual(expect.objectContaining({ type: 'suspended' }));
		expect(retryEvents).toContainEqual(
			expect.objectContaining({ type: 'done', result: expect.objectContaining({ status: 'completed' }) }),
		);
	});

	it('aborts during suspension persistence without exposing or resurrecting the wait', async () => {
		const persistEntered = createDeferred();
		const allowPersist = createDeferred();
		let modelCalls = 0;
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
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (_checkpoint, reason) => {
					if (reason !== 'suspended') return;
					persistEntered.resolve();
					await allowPersist.promise;
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
						: streamFor(assistantMessage([{ type: 'text', text: 'ignored after abort' }], 'stop'));
				},
			},
		);
		const events: AgentEvent[] = [];
		const run = (async () => {
			for await (const event of instance.run()) events.push(event);
		})();
		await persistEntered.promise;
		expect(instance.getPendingRequests()).toEqual([]);
		instance.abort();
		allowPersist.resolve();
		await run;

		expect(instance.status()).toBe('aborted');
		expect(instance.getPendingRequests()).toEqual([]);
		expect((await instance.checkpoint()).toolExecutions).toEqual([]);
		expect(events.some((event) => event.type === 'suspended')).toBe(false);
		expect(events.some((event) => event.type === 'done')).toBe(false);
		expect(events).not.toContainEqual(expect.objectContaining({ type: 'status', status: 'completed' }));
	});

	it('does not acknowledge a resolution when the session aborts during persistence', async () => {
		const resolutionPersistEntered = createDeferred();
		const allowResolutionPersist = createDeferred();
		let modelCalls = 0;
		const tool: Tool<unknown, unknown> = {
			name: 'wait',
			description: 'wait for an event',
			parameters: Type.Object({}),
			canSuspend: true,
			execute: async (_input, context) => {
				const payload = await context.step.waitForEvent('never');
				return { status: 'success', output: payload };
			},
		};
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (_checkpoint, reason) => {
					if (reason !== 'resolution_accepted') return;
					resolutionPersistEntered.resolve();
					await allowResolutionPersist.promise;
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
						: streamFor(assistantMessage([{ type: 'text', text: 'ignored after abort' }], 'stop'));
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

		const resolution = instance.resolve([
			{ suspensionId: pending.suspensionId, type: 'event', payload: 'too-late' },
		]);
		await resolutionPersistEntered.promise;
		expect(instance.getPendingRequests()[0]?.status).toBe('waiting');
		instance.abort();
		allowResolutionPersist.resolve();

		await expect(resolution).rejects.toThrow('Agent aborted during tool lifecycle transition');
		await run;
		expect(instance.status()).toBe('aborted');
		expect(instance.getPendingRequests()).toEqual([]);
		expect((await instance.checkpoint()).toolExecutions).toEqual([]);
		expect(events.some((event) => event.type === 'done')).toBe(false);
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
		let retryMessages: Context['messages'] = [];
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
				streamFn: (_model, context) => {
					modelCalls++;
					if (modelCalls === 1) {
						return streamFor(
							assistantMessage(
								[{ type: 'toolCall', id: 'call-1', name: 'wait', arguments: {} }],
								'toolUse',
							),
						);
					}
					retryMessages = [...context.messages];
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
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
		expect(instance.getPendingRequests()).toEqual([]);
		const retryCheckpoint = await instance.checkpoint();
		expect(retryCheckpoint.toolExecutions).toHaveLength(1);
		expect(retryCheckpoint.toolExecutions[0]?.result).toMatchObject({
			content: [{ type: 'text', text: 'false' }],
			isError: false,
		});
		expect(retryCheckpoint.messages.filter((message) => message.role === 'tool_result')).toHaveLength(1);
		expect(modelCalls).toBe(1);

		failToolCompletion = false;
		for await (const _event of instance.run()) {
			// Retry the retained invocation in the same warm instance.
		}
		const completedCheckpoint = await instance.checkpoint();
		expect(instance.getPendingRequests()).toEqual([]);
		expect(completedCheckpoint.toolExecutions).toEqual([]);
		expect(completedCheckpoint.messages.filter((message) => message.role === 'tool_result')).toHaveLength(1);
		expect(retryMessages.slice(-2).map((message) => message.role)).toEqual(['assistant', 'toolResult']);
		expect(retryMessages.filter((message) => message.role === 'toolResult')).toHaveLength(1);
		expect(modelCalls).toBe(2);
	});

	it('fences aborted replay siblings from a later warm retry generation', async () => {
		const slowStarted = createDeferred();
		const slowObservedAbort = createDeferred();
		let fastAttempts = 0;
		let slowAttempts = 0;
		const tool: Tool<unknown, unknown> = {
			name: 'restored-batch',
			description: 'exercise fail-closed restored replay',
			parameters: Type.Object({ value: Type.String() }),
			canSuspend: true,
			execute: async (input, context) => {
				const { value } = input as { value: string };
				if (value === 'fast') {
					fastAttempts++;
					await slowStarted.promise;
					return { status: 'success', output: value };
				}
				slowAttempts++;
				if (slowAttempts > 1) return { status: 'success', output: value };
				slowStarted.resolve();
				await new Promise<never>((_resolve, reject) => {
					const rejectForAbort = () => {
						slowObservedAbort.resolve();
						reject(new Error('slow sibling aborted'));
					};
					if (context.signal.aborted) {
						rejectForAbort();
						return;
					}
					context.signal.addEventListener('abort', rejectForAbort, { once: true });
				});
				throw new Error('unreachable');
			},
		};
		const request = { type: 'event' as const, eventName: 'resume' };
		const restoreExecution = (toolCallId: string, value: string, sourceOrder: number) => {
			const stepId = `__suspension:event:resume:${sourceOrder}`;
			const suspensionId = createSuspensionId(toolCallId, stepId);
			const resolution = { suspensionId, type: 'event' as const, payload: value };
			return {
				toolName: 'restored-batch',
				toolCallId,
				input: { value },
				sourceOrder,
				completedSteps: [],
				suspendedStep: {
					suspensionId,
					stepId,
					request,
					suspendedAt: 100 + sourceOrder,
					status: 'resolved' as const,
					resolution,
					resumeData: normalizeSuspensionResolution(stepId, request, resolution),
				},
			};
		};
		let failToolCompletion = true;
		let modelCalls = 0;
		let continuationMessages: Context['messages'] = [];
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (_checkpoint, reason) => {
					if (reason === 'tool_completed' && failToolCompletion) {
						failToolCompletion = false;
						throw new Error('restored checkpoint failed');
					}
				},
			},
			testModel,
			'',
			{
				streamFn: (_model, context) => {
					modelCalls++;
					continuationMessages = [...context.messages];
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
				restoreOptions: {
					messages: [
						assistantMessage(
							[
								{
									type: 'toolCall',
									id: 'call-fast',
									name: 'restored-batch',
									arguments: { value: 'fast' },
								},
								{
									type: 'toolCall',
									id: 'call-slow',
									name: 'restored-batch',
									arguments: { value: 'slow' },
								},
							],
							'toolUse',
						),
					],
					sessionId: 'restored-failure-session' as AgentSessionId,
					createdAt: 100,
					turnCount: 1,
					provider: 'anthropic',
					modelId: 'test-model',
					toolExecutions: [
						restoreExecution('call-fast', 'fast', 0),
						restoreExecution('call-slow', 'slow', 1),
					],
				},
			},
		);
		const events: AgentEvent[] = [];

		for await (const event of instance.run()) events.push(event);
		await slowObservedAbort.promise;

		expect(events).toContainEqual(
			expect.objectContaining({ type: 'error', error: 'restored checkpoint failed', fatal: true }),
		);
		const failedCheckpoint = await instance.checkpoint();
		expect(failedCheckpoint.toolExecutions).toHaveLength(2);
		expect(
			failedCheckpoint.toolExecutions.find((execution) => execution.toolCallId === 'call-fast')?.result,
		).toMatchObject({ content: [{ type: 'text', text: 'fast' }], isError: false });
		expect(
			failedCheckpoint.toolExecutions.find((execution) => execution.toolCallId === 'call-slow')?.result,
		).toBeUndefined();

		for await (const _event of instance.run()) {
			// Retry with a new wrapper generation after the persistence failure.
		}

		expect(fastAttempts).toBe(1);
		expect(slowAttempts).toBe(2);
		expect(modelCalls).toBe(1);
		expect(continuationMessages.slice(-2).map((message) => message.role)).toEqual(['toolResult', 'toolResult']);
		expect(continuationMessages.slice(-2)).toMatchObject([
			{ toolCallId: 'call-fast', content: [{ type: 'text', text: 'fast' }] },
			{ toolCallId: 'call-slow', content: [{ type: 'text', text: 'slow' }] },
		]);
		expect((await instance.checkpoint()).toolExecutions).toEqual([]);
	});

	it('does not wake a stale suspended wrapper when resolving before a warm retry', async () => {
		const waitingCheckpointPersisted = createDeferred();
		let waitingInvocations = 0;
		let postWaitExecutions = 0;
		let failSiblingCompletion = true;
		const tool: Tool<unknown, unknown> = {
			name: 'generation-fence',
			description: 'keep a suspended sibling fenced across lifecycle recovery',
			parameters: Type.Object({ kind: Type.String() }),
			canSuspend: true,
			execute: async (input, context) => {
				const { kind } = input as { kind: string };
				if (kind === 'sibling') {
					await waitingCheckpointPersisted.promise;
					return { status: 'success', output: 'sibling-complete' };
				}

				waitingInvocations++;
				const resolution = await context.step.waitForEvent('generation.resume');
				postWaitExecutions++;
				return { status: 'success', output: resolution };
			},
		};
		let modelCalls = 0;
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (_checkpoint, reason) => {
					if (reason === 'suspended') waitingCheckpointPersisted.resolve();
					if (reason === 'tool_completed' && failSiblingCompletion) {
						failSiblingCompletion = false;
						throw new Error('sibling checkpoint failed');
					}
				},
			},
			testModel,
			'',
			{
				streamFn: (_model, context) => {
					modelCalls++;
					if (modelCalls === 1) {
						return streamFor(
							assistantMessage(
								[
									{
										type: 'toolCall',
										id: 'call-waiting',
										name: 'generation-fence',
										arguments: { kind: 'waiting' },
									},
									{
										type: 'toolCall',
										id: 'call-sibling',
										name: 'generation-fence',
										arguments: { kind: 'sibling' },
									},
								],
								'toolUse',
							),
						);
					}
					expect(context.messages.at(-1)?.role).toBe('toolResult');
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
			},
		);
		const events: AgentEvent[] = [];

		for await (const event of instance.run()) events.push(event);
		expect(events).toContainEqual(
			expect.objectContaining({ type: 'error', error: 'sibling checkpoint failed', fatal: true }),
		);
		const [pending] = instance.getPendingRequests();
		if (!pending) throw new Error('Expected the waiting sibling to remain recoverable');

		await instance.resolve([
			{ suspensionId: pending.suspensionId, type: 'event', payload: { generation: 'next' } },
		]);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(waitingInvocations).toBe(1);
		expect(postWaitExecutions).toBe(0);

		for await (const _event of instance.run()) {
			// The accepted resolution is consumed only by the rebuilt wrapper generation.
		}

		expect(waitingInvocations).toBe(2);
		expect(postWaitExecutions).toBe(1);
		expect(modelCalls).toBe(2);
		expect((await instance.checkpoint()).toolExecutions).toEqual([]);
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
		expect(completed[0]?.toolExecutions).toMatchObject([
			{ toolCallId: 'call-1', suspendedStep: { status: 'resolved' }, result: { isError: false } },
		]);
		expect(completed[0]?.messages.filter((message) => message.role === 'tool_result')).toHaveLength(1);
		expect((await instance.checkpoint()).toolExecutions).toEqual([]);
	});

	it('continues once from a persisted completed-batch marker without replaying a tool', async () => {
		const request = { type: 'event' as const, eventName: 'build.finished' };
		const stepId = '__suspension:event:build.finished:0';
		const suspensionId = createSuspensionId('call-1', stepId);
		const resolution = { suspensionId, type: 'event' as const, payload: 'accepted' };
		const execute = vi.fn(async () => ({ status: 'success' as const, output: 'must-not-run' }));
		const tool: Tool<unknown, unknown> = {
			name: 'build',
			description: 'must reuse its persisted result',
			parameters: Type.Object({}),
			canSuspend: true,
			execute,
		};
		const assistant = assistantMessage(
			[{ type: 'toolCall', id: 'call-1', name: 'build', arguments: {} }],
			'toolUse',
		);
		const completedMarkers: InstanceCheckpoint[] = [];
		let modelCalls = 0;
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (checkpoint, reason) => {
					if (reason === 'tool_completed') completedMarkers.push(structuredClone(checkpoint));
				},
			},
			testModel,
			'',
			{
				streamFn: (_model, context) => {
					modelCalls++;
					expect(context.messages.slice(-2).map((message) => message.role)).toEqual([
						'assistant',
						'toolResult',
					]);
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
				restoreOptions: {
					messages: [assistant],
					sessionId: 'continuation-marker-session' as AgentSessionId,
					createdAt: 123,
					turnCount: 1,
					provider: 'anthropic',
					modelId: 'test-model',
					toolExecutions: [
						{
							toolName: 'build',
							toolCallId: 'call-1',
							input: {},
							sourceOrder: 0,
							completedSteps: [],
							suspendedStep: {
								suspensionId,
								stepId,
								request,
								suspendedAt: 100,
								status: 'resolved',
								resolution,
								resumeData: normalizeSuspensionResolution(stepId, request, resolution),
							},
							result: {
								content: [{ type: 'text', text: 'saved-result' }],
								isError: false,
								completedAt: 101,
							},
						},
					],
				},
			},
		);

		for await (const _event of instance.run()) {
			// Drain the recovered continuation.
		}

		expect(execute).not.toHaveBeenCalled();
		expect(modelCalls).toBe(1);
		expect(completedMarkers).toHaveLength(1);
		expect(completedMarkers[0]?.toolExecutions[0]?.result).toMatchObject({
			content: [{ type: 'text', text: 'saved-result' }],
		});
		expect((await instance.checkpoint()).toolExecutions).toEqual([]);
	});

	it('recovers an unfinished ordinary sibling after the suspended call already completed', async () => {
		const request = { type: 'event' as const, eventName: 'build.finished' };
		const stepId = '__suspension:event:build.finished:0';
		const suspensionId = createSuspensionId('call-waiting', stepId);
		const resolution = { suspensionId, type: 'event' as const, payload: 'accepted' };
		const execute = vi.fn(async (input: unknown) => {
			const { value } = input as { value: string };
			if (value === 'completed') throw new Error('completed invocation must not replay');
			return { status: 'success' as const, output: `replayed:${value}` };
		});
		const tool: Tool<unknown, unknown> = {
			name: 'build',
			description: 'finish the remaining sibling',
			parameters: Type.Object({ value: Type.String() }),
			canSuspend: true,
			execute,
		};
		const assistant = assistantMessage(
			[
				{ type: 'toolCall', id: 'call-waiting', name: 'build', arguments: { value: 'completed' } },
				{ type: 'toolCall', id: 'call-sibling', name: 'build', arguments: { value: 'sibling' } },
			],
			'toolUse',
		);
		let continuationResults: Context['messages'] = [];
		let modelCalls = 0;
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async () => {},
			},
			testModel,
			'',
			{
				streamFn: (_model, context) => {
					modelCalls++;
					continuationResults = context.messages.filter((message) => message.role === 'toolResult');
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
				restoreOptions: {
					messages: [assistant],
					sessionId: 'unfinished-sibling-session' as AgentSessionId,
					createdAt: 100,
					turnCount: 1,
					provider: 'anthropic',
					modelId: 'test-model',
					toolExecutions: [
						{
							toolName: 'build',
							toolCallId: 'call-waiting',
							input: { value: 'completed' },
							sourceOrder: 0,
							completedSteps: [],
							suspendedStep: {
								suspensionId,
								stepId,
								request,
								suspendedAt: 100,
								status: 'resolved',
								resolution,
								resumeData: normalizeSuspensionResolution(stepId, request, resolution),
							},
							result: {
								content: [{ type: 'text', text: 'saved:completed' }],
								isError: false,
								completedAt: 101,
							},
						},
						{
							toolName: 'build',
							toolCallId: 'call-sibling',
							input: { value: 'sibling' },
							sourceOrder: 1,
							completedSteps: [],
						},
					],
				},
			},
		);

		for await (const _event of instance.run()) {
			// Drain the remaining sibling and its one model continuation.
		}

		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledWith({ value: 'sibling' }, expect.any(Object));
		expect(modelCalls).toBe(1);
		expect(
			continuationResults.map((message) => ('toolCallId' in message ? message.toolCallId : undefined)),
		).toEqual(['call-waiting', 'call-sibling']);
		expect(continuationResults).toMatchObject([
			{ content: [{ text: 'saved:completed' }] },
			{ content: [{ text: 'replayed:sibling' }] },
		]);
		expect((await instance.checkpoint()).toolExecutions).toEqual([]);
	});

	it('keeps retained preflight results in assistant source order when recovering a committed marker', async () => {
		const request = { type: 'event' as const, eventName: 'build.finished' };
		const stepId = '__suspension:event:build.finished:0';
		const suspensionId = createSuspensionId('call-tracked', stepId);
		const resolution = { suspensionId, type: 'event' as const, payload: 'accepted' };
		const execute = vi.fn(async () => ({ status: 'success' as const, output: 'must-not-run' }));
		const tool: Tool<unknown, unknown> = {
			name: 'build',
			description: 'must reuse its persisted result',
			parameters: Type.Object({ value: Type.String() }),
			canSuspend: true,
			execute,
		};
		const assistant = assistantMessage(
			[
				{ type: 'toolCall', id: 'call-tracked', name: 'build', arguments: { value: 'valid' } },
				{ type: 'toolCall', id: 'call-invalid', name: 'build', arguments: { value: 42 } },
			],
			'toolUse',
		);
		const trackedResult = agentToolResultToPiMessage(
			'call-tracked',
			'build',
			{ content: [{ type: 'text', text: 'stale-result' }], details: undefined },
			false,
		);
		const preflightResult = agentToolResultToPiMessage(
			'call-invalid',
			'build',
			{ content: [{ type: 'text', text: 'Invalid arguments' }], details: undefined },
			true,
		);
		let continuationResults: Context['messages'] = [];
		let modelCalls = 0;
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				tools: createToolRegistryWith({}, tool),
			},
			testModel,
			'',
			{
				streamFn: (_model, context) => {
					modelCalls++;
					continuationResults = context.messages.filter((message) => message.role === 'toolResult');
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
				restoreOptions: {
					messages: [assistant, trackedResult, preflightResult],
					sessionId: 'preflight-marker-session' as AgentSessionId,
					createdAt: 123,
					turnCount: 1,
					provider: 'anthropic',
					modelId: 'test-model',
					toolExecutions: [
						{
							toolName: 'build',
							toolCallId: 'call-tracked',
							input: { value: 'valid' },
							sourceOrder: 0,
							completedSteps: [],
							suspendedStep: {
								suspensionId,
								stepId,
								request,
								suspendedAt: 100,
								status: 'resolved',
								resolution,
								resumeData: normalizeSuspensionResolution(stepId, request, resolution),
							},
							result: {
								content: [{ type: 'text', text: 'saved-result' }],
								isError: false,
								completedAt: 101,
							},
						},
					],
				},
			},
		);

		for await (const _event of instance.run()) {
			// Drain the recovered continuation through the installed Pi agent.
		}

		expect(execute).not.toHaveBeenCalled();
		expect(modelCalls).toBe(1);
		expect(
			continuationResults.map((message) => ('toolCallId' in message ? message.toolCallId : undefined)),
		).toEqual(['call-tracked', 'call-invalid']);
		expect(continuationResults).toMatchObject([
			{ content: [{ text: 'saved-result' }], isError: false },
			{ content: [{ text: 'Invalid arguments' }], isError: true },
		]);
	});

	it('retains a preflight failure when a sibling suspension is recovered before the batch barrier', async () => {
		const execute = vi.fn(async (_input: unknown, context: Parameters<Tool['execute']>[1]) => {
			const payload = await context.step.waitForEvent('build.finished');
			return { status: 'success' as const, output: payload };
		});
		const tool: Tool<unknown, unknown> = {
			name: 'build',
			description: 'wait for an external build',
			parameters: Type.Object({ value: Type.String() }),
			canSuspend: true,
			execute,
		};
		const checkpoints: InstanceCheckpoint[] = [];
		let initialModelCalls = 0;
		const first = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (checkpoint) => {
					checkpoints.push(structuredClone(checkpoint));
				},
			},
			testModel,
			'',
			{
				streamFn: () => {
					initialModelCalls++;
					return initialModelCalls === 1
						? streamFor(
								assistantMessage(
									[
										{
											type: 'toolCall',
											id: 'call-invalid',
											name: 'build',
											arguments: { value: 42 },
										},
										{
											type: 'toolCall',
											id: 'call-waiting',
											name: 'build',
											arguments: { value: 'valid' },
										},
									],
									'toolUse',
								),
							)
						: streamFor(assistantMessage([{ type: 'text', text: 'ignored after abort' }], 'stop'));
				},
			},
		);
		const firstRun = (async () => {
			for await (const _event of first.run()) {
				// Drain until the simulated process crash.
			}
		})();

		await vi.waitFor(() => expect(first.getPendingRequests()).toHaveLength(1));
		const partial = checkpoints.at(-1);
		if (!partial) throw new Error('Expected a suspended partial-batch checkpoint');
		expect(partial.toolExecutions).toMatchObject([
			{
				toolCallId: 'call-invalid',
				input: { value: 42 },
				result: { isError: true },
			},
			{
				toolCallId: 'call-waiting',
				input: { value: 'valid' },
				suspendedStep: { status: 'waiting' },
			},
		]);
		first.abort();
		await firstRun;

		let continuationResults: Context['messages'] = [];
		let continuationCalls = 0;
		const restored = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async () => {},
			},
			testModel,
			'',
			{
				streamFn: (_model, context) => {
					continuationCalls++;
					continuationResults = context.messages.filter((message) => message.role === 'toolResult');
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
				restoreOptions: {
					messages: checkpointToPiMessages(partial.messages),
					sessionId: partial.session.id,
					createdAt: partial.session.createdAt,
					turnCount: partial.session.metrics.turns ?? 0,
					provider: 'anthropic',
					modelId: 'test-model',
					toolExecutions: structuredClone(partial.toolExecutions),
				},
			},
		);
		const restoredRun = (async () => {
			for await (const _event of restored.run()) {
				// Drain through the recovered batch and its one model continuation.
			}
		})();
		await vi.waitFor(() => expect(restored.getPendingRequests()).toHaveLength(1));
		const [pending] = restored.getPendingRequests();
		if (!pending) throw new Error('Expected the restored suspension');
		await restored.resolve([{ suspensionId: pending.suspensionId, type: 'event', payload: 'accepted' }]);
		await restoredRun;

		expect(execute).toHaveBeenCalledTimes(2);
		expect(continuationCalls).toBe(1);
		expect(
			continuationResults.map((message) => ('toolCallId' in message ? message.toolCallId : undefined)),
		).toEqual(['call-invalid', 'call-waiting']);
		expect(continuationResults).toMatchObject([
			{ isError: true },
			{ content: [{ text: expect.stringContaining('accepted') }], isError: false },
		]);
	});

	it('executes overlapping calls concurrently and publishes reverse completions in source order', async () => {
		const gates = new Map([
			['a', createDeferred<void>()],
			['b', createDeferred<void>()],
		]);
		const bothStarted = createDeferred<void>();
		const started: string[] = [];
		const completionOrder: string[] = [];
		const tool: Tool<unknown, unknown> = {
			name: 'parallel',
			description: 'complete independently',
			parameters: Type.Object({ value: Type.String() }),
			execute: async (input) => {
				const { value } = input as { value: string };
				started.push(value);
				if (started.length === 2) bothStarted.resolve();
				await gates.get(value)?.promise;
				completionOrder.push(value);
				return { status: 'success', output: `result:${value}` };
			},
		};
		let modelCalls = 0;
		let continuationResults: Context['messages'] = [];
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
			},
			testModel,
			'',
			{
				streamFn: (_model, context) => {
					modelCalls++;
					if (modelCalls === 1) {
						return streamFor(
							assistantMessage(
								[
									{ type: 'toolCall', id: 'call-a', name: 'parallel', arguments: { value: 'a' } },
									{ type: 'toolCall', id: 'call-b', name: 'parallel', arguments: { value: 'b' } },
								],
								'toolUse',
							),
						);
					}
					continuationResults = context.messages.filter((message) => message.role === 'toolResult');
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
			},
		);
		const run = (async () => {
			for await (const _event of instance.run()) {
				// Drain the real Pi parallel batch.
			}
		})();

		await bothStarted.promise;
		expect(started).toEqual(['a', 'b']);
		gates.get('b')?.resolve();
		await vi.waitFor(() => expect(completionOrder).toEqual(['b']));
		gates.get('a')?.resolve();
		await run;

		expect(completionOrder).toEqual(['b', 'a']);
		expect(
			continuationResults.map((message) => ('toolCallId' in message ? message.toolCallId : undefined)),
		).toEqual(['call-a', 'call-b']);
		expect(modelCalls).toBe(2);
	});

	it('keeps one suspended call isolated while its sibling completes', async () => {
		const releaseSibling = createDeferred<void>();
		const siblingPrepared = createDeferred<void>();
		const siblingReturned = createDeferred<void>();
		const executionCounts = new Map<string, number>();
		const checkpoints: Array<{ reason: string; checkpoint: InstanceCheckpoint }> = [];
		const tool: Tool<unknown, unknown> = {
			name: 'mixed-batch',
			description: 'suspend only the requested call',
			parameters: Type.Object({ value: Type.String(), suspend: Type.Boolean() }),
			canSuspend: true,
			execute: async (input, context) => {
				const { value, suspend } = input as { value: string; suspend: boolean };
				executionCounts.set(value, (executionCounts.get(value) ?? 0) + 1);
				const prepared = await context.step.run('prepare', async () => `prepared:${value}`);
				if (suspend) {
					await siblingPrepared.promise;
					const payload = await context.step.waitForEvent(`event.${value}`);
					return { status: 'success', output: { prepared, payload } };
				}
				siblingPrepared.resolve();
				await releaseSibling.promise;
				siblingReturned.resolve();
				return { status: 'success', output: { prepared } };
			},
		};
		let modelCalls = 0;
		let continuationToolCallIds: string[] = [];
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (checkpoint, reason) => {
					checkpoints.push({ reason, checkpoint: structuredClone(checkpoint) });
				},
			},
			testModel,
			'',
			{
				streamFn: (_model, context) => {
					modelCalls++;
					if (modelCalls === 1) {
						return streamFor(
							assistantMessage(
								[
									{
										type: 'toolCall',
										id: 'call-waiting',
										name: 'mixed-batch',
										arguments: { value: 'waiting', suspend: true },
									},
									{
										type: 'toolCall',
										id: 'call-sibling',
										name: 'mixed-batch',
										arguments: { value: 'sibling', suspend: false },
									},
								],
								'toolUse',
							),
						);
					}
					continuationToolCallIds = context.messages
						.filter((message) => message.role === 'toolResult')
						.map((message) => ('toolCallId' in message ? message.toolCallId : ''));
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
			},
		);
		const run = (async () => {
			for await (const _event of instance.run()) {
				// Drain until the suspended call is resumed.
			}
		})();

		await vi.waitFor(() => expect(instance.getPendingRequests()).toHaveLength(1));
		expect(instance.status()).toBe('running');
		expect(instance.getPendingRequests()[0]).toMatchObject({
			toolCallId: 'call-waiting',
			toolName: 'mixed-batch',
			status: 'waiting',
		});
		const suspended = checkpoints.find(({ reason }) => reason === 'suspended')?.checkpoint;
		expect(suspended?.toolExecutions).toMatchObject([
			{
				toolCallId: 'call-waiting',
				completedSteps: [{ stepId: 'prepare', result: 'prepared:waiting' }],
			},
			{
				toolCallId: 'call-sibling',
				completedSteps: [{ stepId: 'prepare', result: 'prepared:sibling' }],
			},
		]);
		expect(suspended?.toolExecutions.find((execution) => execution.toolCallId === 'call-sibling')?.result).toBe(
			undefined,
		);
		releaseSibling.resolve();
		await siblingReturned.promise;
		await vi.waitFor(() =>
			expect(
				checkpoints.some(({ checkpoint }) =>
					checkpoint.toolExecutions.some(
						(execution) => execution.toolCallId === 'call-sibling' && execution.result !== undefined,
					),
				),
			).toBe(true),
		);
		expect(instance.status()).toBe('waiting');

		const partial = checkpoints.find(({ checkpoint }) =>
			checkpoint.toolExecutions.some(
				(execution) => execution.toolCallId === 'call-sibling' && execution.result !== undefined,
			),
		)?.checkpoint;
		expect(partial?.toolExecutions).toMatchObject([
			{
				toolCallId: 'call-waiting',
				input: { value: 'waiting', suspend: true },
				completedSteps: [{ stepId: 'prepare', result: 'prepared:waiting' }],
				suspendedStep: { status: 'waiting' },
			},
			{
				toolCallId: 'call-sibling',
				input: { value: 'sibling', suspend: false },
				completedSteps: [{ stepId: 'prepare', result: 'prepared:sibling' }],
				result: { isError: false },
			},
		]);
		const [pending] = instance.getPendingRequests();
		if (!pending) throw new Error('Expected the suspended call');
		await instance.resolve([{ suspensionId: pending.suspensionId, type: 'event', payload: 'accepted' }]);
		await run;

		expect(executionCounts).toEqual(
			new Map([
				['waiting', 2],
				['sibling', 1],
			]),
		);
		expect(continuationToolCallIds).toEqual(['call-waiting', 'call-sibling']);
		expect(modelCalls).toBe(2);
	});

	it('accepts two suspensions together in reverse order while preserving per-call ownership', async () => {
		const completionGates = new Map([
			['a', createDeferred<void>()],
			['b', createDeferred<void>()],
		]);
		const bothResumed = createDeferred<void>();
		const resumed: string[] = [];
		const completionOrder: string[] = [];
		const checkpoints: Array<{ reason: string; checkpoint: InstanceCheckpoint }> = [];
		const tool: Tool<unknown, unknown> = {
			name: 'double-wait',
			description: 'wait independently',
			parameters: Type.Object({ value: Type.String() }),
			canSuspend: true,
			execute: async (input, context) => {
				const { value } = input as { value: string };
				const prepared = await context.step.run('prepare', async () => `prepared:${value}`);
				const payload = await context.step.waitForEvent(`event.${value}`);
				resumed.push(value);
				if (resumed.length === 2) bothResumed.resolve();
				await completionGates.get(value)?.promise;
				completionOrder.push(value);
				return { status: 'success', output: { value, prepared, payload } };
			},
		};
		let modelCalls = 0;
		let continuationResults: Context['messages'] = [];
		const instance = new PiAgentInstance(
			{
				guidance: { root: '/guidance' } as GuidanceContext,
				input: { message: 'start' },
				tools: createToolRegistryWith({}, tool),
				onCheckpoint: async (checkpoint, reason) => {
					checkpoints.push({ reason, checkpoint: structuredClone(checkpoint) });
				},
			},
			testModel,
			'',
			{
				streamFn: (_model, context) => {
					modelCalls++;
					if (modelCalls === 1) {
						return streamFor(
							assistantMessage(
								[
									{ type: 'toolCall', id: 'call-a', name: 'double-wait', arguments: { value: 'a' } },
									{ type: 'toolCall', id: 'call-b', name: 'double-wait', arguments: { value: 'b' } },
								],
								'toolUse',
							),
						);
					}
					continuationResults = context.messages.filter((message) => message.role === 'toolResult');
					return streamFor(assistantMessage([{ type: 'text', text: 'done' }], 'stop'));
				},
			},
		);
		const run = (async () => {
			for await (const _event of instance.run()) {
				// Drain through the single continuation after the batch resolves.
			}
		})();

		await vi.waitFor(() => expect(instance.getPendingRequests()).toHaveLength(2));
		const initial = await instance.checkpoint();
		expect(initial.toolExecutions).toMatchObject([
			{
				toolCallId: 'call-a',
				input: { value: 'a' },
				completedSteps: [{ stepId: 'prepare', result: 'prepared:a' }],
				suspendedStep: { request: { eventName: 'event.a' }, status: 'waiting' },
			},
			{
				toolCallId: 'call-b',
				input: { value: 'b' },
				completedSteps: [{ stepId: 'prepare', result: 'prepared:b' }],
				suspendedStep: { request: { eventName: 'event.b' }, status: 'waiting' },
			},
		]);
		const [pendingA, pendingB] = instance.getPendingRequests();
		if (!pendingA || !pendingB) throw new Error('Expected both suspended calls');
		const resolutionB = { suspensionId: pendingB.suspensionId, type: 'event' as const, payload: 'answer-b' };
		const resolutionA = { suspensionId: pendingA.suspensionId, type: 'event' as const, payload: 'answer-a' };
		await instance.resolve([resolutionB, resolutionA]);
		expect(checkpoints.filter(({ reason }) => reason === 'resolution_accepted')).toHaveLength(1);
		await bothResumed.promise;

		completionGates.get('b')?.resolve();
		await vi.waitFor(() => expect(completionOrder).toEqual(['b']));
		await vi.waitFor(() =>
			expect(
				checkpoints.some(({ checkpoint }) =>
					checkpoint.toolExecutions.some(
						(execution) => execution.toolCallId === 'call-b' && execution.result !== undefined,
					),
				),
			).toBe(true),
		);
		await expect(instance.resolve([resolutionB, resolutionB, resolutionA])).resolves.toBeUndefined();
		await expect(
			instance.resolve([resolutionB, { ...resolutionB, payload: 'conflicting-answer-b' }]),
		).rejects.toThrow('conflicting requested resolutions');
		completionGates.get('a')?.resolve();
		await run;

		expect(completionOrder).toEqual(['b', 'a']);
		expect(
			continuationResults.map((message) => ('toolCallId' in message ? message.toolCallId : undefined)),
		).toEqual(['call-a', 'call-b']);
		expect(
			continuationResults.map((message) =>
				'content' in message && Array.isArray(message.content) && message.content[0]?.type === 'text'
					? message.content[0].text
					: undefined,
			),
		).toEqual([expect.stringContaining('answer-a'), expect.stringContaining('answer-b')]);
		expect(modelCalls).toBe(2);
	});
});
