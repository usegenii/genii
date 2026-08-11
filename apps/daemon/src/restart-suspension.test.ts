import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Destination } from '@genii/comms/destination/types';
import type { InboundEvent, OutboundIntent } from '@genii/comms/events/types';
import type { ChannelRegistry } from '@genii/comms/registry/types';
import type { ChannelId } from '@genii/comms/types/core';
import { PiAgentInstance } from '@genii/orchestrator/adapters/pi/instance';
import { checkpointToPiMessages } from '@genii/orchestrator/adapters/pi/messages';
import type { AdapterCreateConfig, AgentAdapter, AgentInstance } from '@genii/orchestrator/adapters/types';
import { createCoordinator } from '@genii/orchestrator/coordinator/impl';
import type { Coordinator } from '@genii/orchestrator/coordinator/types';
import { createFileSnapshotStore } from '@genii/orchestrator/snapshot/store';
import type { AgentCheckpoint } from '@genii/orchestrator/snapshot/types';
import { createToolRegistryWith } from '@genii/orchestrator/tools/registry';
import type { Tool, ToolRegistryInterface } from '@genii/orchestrator/tools/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationManager } from './conversations/manager';
import { createFileConversationStore } from './conversations/store';
import type { Logger } from './logging/logger';
import { MessageRouter } from './router/router';

type PiInstanceOptions = NonNullable<ConstructorParameters<typeof PiAgentInstance>[3]>;
type PiModel = ConstructorParameters<typeof PiAgentInstance>[1];
type PiStreamFn = NonNullable<PiInstanceOptions['streamFn']>;
type StreamReturn = ReturnType<PiStreamFn>;

interface TestAssistantMessage {
	role: 'assistant';
	content: Array<
		| { type: 'text'; text: string }
		| { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
	>;
	api: 'anthropic-messages';
	provider: string;
	model: string;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		cost: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			total: number;
		};
	};
	stopReason: 'stop' | 'toolUse';
	timestamp: number;
}

type TestAssistantEvent =
	| { type: 'start'; partial: TestAssistantMessage }
	| { type: 'done'; reason: TestAssistantMessage['stopReason']; message: TestAssistantMessage };

class TestEventStream implements AsyncIterable<TestAssistantEvent> {
	private readonly events: TestAssistantEvent[] = [];
	private readonly waiters: Array<(result: IteratorResult<TestAssistantEvent>) => void> = [];
	private readonly resultPromise: Promise<TestAssistantMessage>;
	private resolveResult!: (message: TestAssistantMessage) => void;
	private complete = false;

	constructor() {
		this.resultPromise = new Promise((resolve) => {
			this.resolveResult = resolve;
		});
	}

	push(event: TestAssistantEvent): void {
		if (this.complete) return;
		if (event.type === 'done') {
			this.complete = true;
			this.resolveResult(event.message);
		}
		const waiter = this.waiters.shift();
		if (waiter) {
			waiter({ value: event, done: false });
		} else {
			this.events.push(event);
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<TestAssistantEvent> {
		while (true) {
			const event = this.events.shift();
			if (event) {
				yield event;
				continue;
			}
			if (this.complete) return;
			const next = await new Promise<IteratorResult<TestAssistantEvent>>((resolve) => {
				this.waiters.push(resolve);
			});
			yield next.value;
		}
	}

	result(): Promise<TestAssistantMessage> {
		return this.resultPromise;
	}
}

function assistantMessage(
	content: TestAssistantMessage['content'],
	stopReason: TestAssistantMessage['stopReason'],
): TestAssistantMessage {
	return {
		role: 'assistant',
		content,
		api: 'anthropic-messages',
		provider: 'fake-provider',
		model: 'fake-model',
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

function streamFor(message: TestAssistantMessage): StreamReturn {
	const stream = new TestEventStream();
	queueMicrotask(() => {
		stream.push({ type: 'start', partial: message });
		stream.push({ type: 'done', reason: message.stopReason, message });
	});
	return stream as unknown as StreamReturn;
}

const testModel = {
	id: 'fake-model',
	name: 'fake-model',
	api: 'anthropic-messages',
	provider: 'fake-provider',
	baseUrl: 'https://example.invalid',
	reasoning: false,
	input: ['text'],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 1_000,
} as PiModel;

class CredentialFreePiAdapter implements AgentAdapter {
	readonly name = 'pi';
	readonly modelProvider = 'fake-provider';
	readonly modelName = 'fake-model';

	constructor(
		private readonly streamFn: PiStreamFn,
		private readonly onModelCreated: () => void,
	) {}

	async create(config: AdapterCreateConfig): Promise<AgentInstance> {
		this.onModelCreated();
		return new PiAgentInstance(config, testModel, '', { streamFn: this.streamFn });
	}

	async restore(checkpoint: AgentCheckpoint, config: AdapterCreateConfig): Promise<AgentInstance> {
		this.onModelCreated();
		return new PiAgentInstance(config, testModel, '', {
			streamFn: this.streamFn,
			restoreOptions: {
				messages: checkpointToPiMessages(checkpoint.messages),
				sessionId: checkpoint.session.id,
				createdAt: checkpoint.session.createdAt,
				turnCount: checkpoint.session.metrics.turns,
				provider: checkpoint.adapterConfig.provider,
				modelId: checkpoint.adapterConfig.model,
				toolExecutions: checkpoint.toolExecutions,
			},
		});
	}
}

function createMockLogger(): Logger {
	const logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(() => logger),
	};
	return logger as unknown as Logger;
}

interface SentIntent {
	channelId: ChannelId;
	intent: OutboundIntent;
}

function createChannelRegistry(sent: SentIntent[]): ChannelRegistry {
	return {
		register: vi.fn(),
		unregister: vi.fn(),
		get: vi.fn(),
		list: vi.fn(() => []),
		subscribe: vi.fn(() => () => {}),
		events: vi.fn(() => ({
			[Symbol.asyncIterator]: async function* () {
				// This credential-free channel has no inbound event source.
			},
		})),
		process: vi.fn(async (channelId: ChannelId, intent: OutboundIntent) => {
			sent.push({ channelId, intent });
			return { intentType: intent.type, success: true, timestamp: Date.now() };
		}),
	};
}

interface TestRuntime {
	coordinator: Coordinator;
	conversations: ConversationManager;
	router: MessageRouter;
}

function createRuntime(options: {
	snapshotDirectory: string;
	conversationPath: string;
	guidancePath: string;
	adapter: AgentAdapter;
	tools: ToolRegistryInterface;
	sent: SentIntent[];
}): TestRuntime {
	const logger = createMockLogger();
	const coordinator = createCoordinator({
		defaultGuidancePath: options.guidancePath,
		snapshotStore: createFileSnapshotStore({ directory: options.snapshotDirectory }),
	});
	const conversations = new ConversationManager(
		logger,
		createFileConversationStore(options.conversationPath, logger),
	);
	const router = new MessageRouter({
		coordinator,
		channelRegistry: createChannelRegistry(options.sent),
		conversationManager: conversations,
		adapterFactory: async () => options.adapter,
		defaultSpawnContext: { guidancePath: options.guidancePath },
		logger,
		toolRegistry: options.tools,
	});

	return { coordinator, conversations, router };
}

async function startRuntime(runtime: TestRuntime): Promise<void> {
	await runtime.coordinator.start();
	await runtime.conversations.start();
	await runtime.router.start();
}

let temporaryDirectory: string | undefined;

afterEach(async () => {
	if (temporaryDirectory) {
		await rm(temporaryDirectory, { recursive: true, force: true });
		temporaryDirectory = undefined;
	}
});

describe('durable suspension daemon restart', () => {
	it('survives suspension and accepted-resolution crashes without changing the conversation', async () => {
		temporaryDirectory = await mkdtemp(join(tmpdir(), 'genii-durable-suspension-'));
		const snapshotDirectory = join(temporaryDirectory, 'snapshots');
		const conversationPath = join(temporaryDirectory, 'conversations.json');
		const guidancePath = join(temporaryDirectory, 'guidance');
		await mkdir(guidancePath, { recursive: true });

		let sideEffectCount = 0;
		let modelCreationCount = 0;
		const sent: SentIntent[] = [];
		const tool: Tool<unknown, unknown> = {
			name: 'wait-for-build',
			description: 'Prepare once and wait for an external build event',
			parameters: { type: 'object', properties: {} } as unknown as Tool<unknown, unknown>['parameters'],
			canSuspend: true,
			execute: async (_input, context) => {
				const prepared = await context.step.run('prepare-build', async () => {
					sideEffectCount++;
					return 'prepared';
				});
				const event = await context.step.waitForEvent('build.finished');
				return { status: 'success', output: { prepared, event } };
			},
		};
		const tools = createToolRegistryWith({}, tool);
		const streamFn: PiStreamFn = (_model, context) => {
			const lastMessage = context.messages.at(-1);
			if (lastMessage?.role === 'user') {
				return streamFor(
					assistantMessage(
						[{ type: 'toolCall', id: 'build-call-1', name: tool.name, arguments: {} }],
						'toolUse',
					),
				);
			}
			if (lastMessage?.role === 'toolResult') {
				return streamFor(assistantMessage([{ type: 'text', text: 'Build finished successfully.' }], 'stop'));
			}
			throw new Error(`Unexpected model history ending in ${lastMessage?.role ?? 'no message'}`);
		};
		const createAdapter = () =>
			new CredentialFreePiAdapter(streamFn, () => {
				modelCreationCount++;
			});
		const destination: Destination = {
			channelId: 'test-channel' as ChannelId,
			ref: 'conversation-42',
		};

		const first = createRuntime({
			snapshotDirectory,
			conversationPath,
			guidancePath,
			adapter: createAdapter(),
			tools,
			sent,
		});
		await startRuntime(first);
		const firstHandle = await first.coordinator.spawn(createAdapter(), {
			guidancePath,
			input: { message: 'Start the build.' },
			tools,
		});
		await first.conversations.bind(destination, firstHandle.id);
		void firstHandle.start();

		await vi.waitFor(async () => {
			expect(await first.coordinator.getPendingRequests(firstHandle.id)).toHaveLength(1);
			expect(firstHandle.status).toBe('waiting');
		});
		const sessionId = firstHandle.id;
		const suspendedCheckpoint = await first.coordinator.loadCheckpoint(sessionId);
		if (!suspendedCheckpoint) throw new Error('Expected the suspended checkpoint');
		const originalHistory = structuredClone(suspendedCheckpoint.messages);
		expect(sideEffectCount).toBe(1);
		expect(suspendedCheckpoint.toolExecutions[0]?.suspendedStep?.status).toBe('waiting');

		await first.router.stop();
		await first.coordinator.shutdown();
		await first.conversations.stop();

		const second = createRuntime({
			snapshotDirectory,
			conversationPath,
			guidancePath,
			adapter: createAdapter(),
			tools,
			sent,
		});
		await startRuntime(second);
		expect(second.conversations.getByAgent(sessionId)?.destination).toEqual(destination);
		const creationsBeforeInspection = modelCreationCount;
		const [dormantRequest] = await second.coordinator.getPendingRequests(sessionId);
		if (!dormantRequest) throw new Error('Expected a dormant pending request');
		expect(modelCreationCount).toBe(creationsBeforeInspection);
		expect(dormantRequest.status).toBe('waiting');

		const resolution = {
			suspensionId: dormantRequest.suspensionId,
			type: 'event' as const,
			payload: { conclusion: 'success' },
		};
		const acceptedHandle = await second.coordinator.restoreSuspended(sessionId, createAdapter(), { tools });
		expect(acceptedHandle.status).toBe('waiting');
		await acceptedHandle.resolve([resolution]);
		expect(acceptedHandle.status).toBe('waiting');
		const acceptedCheckpoint = await second.coordinator.loadCheckpoint(sessionId);
		expect(acceptedCheckpoint?.toolExecutions[0]?.suspendedStep).toMatchObject({
			status: 'resolved',
			resolution,
		});
		expect(acceptedCheckpoint?.messages).toEqual(originalHistory);

		// Simulate a crash immediately after acceptance: never start this restored handle.
		await second.router.stop();
		await second.coordinator.shutdown();
		await second.conversations.stop();
		const acceptedAfterShutdown = await second.coordinator.loadCheckpoint(sessionId);
		expect(acceptedAfterShutdown?.toolExecutions[0]?.suspendedStep).toMatchObject({
			status: 'resolved',
			resolution,
		});

		const third = createRuntime({
			snapshotDirectory,
			conversationPath,
			guidancePath,
			adapter: createAdapter(),
			tools,
			sent,
		});
		await startRuntime(third);
		expect(third.conversations.getByAgent(sessionId)?.destination).toEqual(destination);
		const finalHandle = await third.coordinator.resolveSuspensions(sessionId, [resolution], createAdapter(), {
			tools,
		});
		const result = await finalHandle.wait();
		expect(result).toMatchObject({ status: 'completed', output: 'Build finished successfully.' });

		await vi.waitFor(async () => {
			const checkpoint = await third.coordinator.loadCheckpoint(sessionId);
			expect(checkpoint?.messages.at(-1)?.content).toEqual([
				{ type: 'text', text: 'Build finished successfully.' },
			]);
		});
		const finalCheckpoint = await third.coordinator.loadCheckpoint(sessionId);
		if (!finalCheckpoint) throw new Error('Expected a final checkpoint');
		expect(finalHandle.id).toBe(sessionId);
		expect(finalCheckpoint.session.id).toBe(sessionId);
		expect(finalCheckpoint.messages.slice(0, originalHistory.length)).toEqual(originalHistory);
		expect(finalCheckpoint.messages.filter((message) => message.role === 'user')).toHaveLength(1);
		expect(finalCheckpoint.messages.filter((message) => message.role === 'tool_result')).toHaveLength(1);
		expect(finalCheckpoint.toolExecutions).toEqual([]);
		expect(await third.coordinator.getPendingRequests(sessionId)).toEqual([]);
		expect(sideEffectCount).toBe(1);

		await vi.waitFor(() => {
			expect(
				sent.some(
					({ channelId, intent }) =>
						channelId === destination.channelId &&
						intent.type === 'agent_responding' &&
						intent.destination.ref === destination.ref &&
						intent.content.type === 'text' &&
						intent.content.text === 'Build finished successfully.',
				),
			).toBe(true);
		});

		await third.router.stop();
		await third.coordinator.shutdown();
		await third.conversations.stop();
	});

	it('restores a partially completed parallel batch and continues the model exactly once', async () => {
		temporaryDirectory = await mkdtemp(join(tmpdir(), 'genii-parallel-suspension-'));
		const snapshotDirectory = join(temporaryDirectory, 'snapshots');
		const conversationPath = join(temporaryDirectory, 'conversations.json');
		const guidancePath = join(temporaryDirectory, 'guidance');
		await mkdir(guidancePath, { recursive: true });

		let completedSiblingExecutions = 0;
		let firstPreparationCount = 0;
		let secondPreparationCount = 0;
		let modelContinuationCount = 0;
		let modelCreationCount = 0;
		let continuationToolCallIds: string[] = [];
		const sent: SentIntent[] = [];
		const completedSibling: Tool<unknown, unknown> = {
			name: 'complete-immediately',
			description: 'Complete while sibling tools are suspended',
			parameters: { type: 'object', properties: {} } as unknown as Tool<unknown, unknown>['parameters'],
			execute: async (input) => {
				completedSiblingExecutions++;
				return { status: 'success', output: { completed: true, owner: (input as { owner: string }).owner } };
			},
		};
		const firstSuspendingTool: Tool<unknown, unknown> = {
			name: 'wait-for-first-event',
			description: 'Prepare once and wait for the first external event',
			parameters: { type: 'object', properties: {} } as unknown as Tool<unknown, unknown>['parameters'],
			canSuspend: true,
			execute: async (input, context) => {
				const owner = (input as { owner: string }).owner;
				const prepared = await context.step.run('prepare-first', async () => {
					firstPreparationCount++;
					return `${owner}-prepared`;
				});
				const event = await context.step.waitForEvent('first.finished');
				return { status: 'success', output: { owner, prepared, event } };
			},
		};
		const secondSuspendingTool: Tool<unknown, unknown> = {
			name: 'wait-for-second-event',
			description: 'Prepare once and wait for the second external event',
			parameters: { type: 'object', properties: {} } as unknown as Tool<unknown, unknown>['parameters'],
			canSuspend: true,
			execute: async (input, context) => {
				const owner = (input as { owner: string }).owner;
				const prepared = await context.step.run('prepare-second', async () => {
					secondPreparationCount++;
					return `${owner}-prepared`;
				});
				const event = await context.step.waitForEvent('second.finished');
				return { status: 'success', output: { owner, prepared, event } };
			},
		};
		const tools = createToolRegistryWith({}, completedSibling, firstSuspendingTool, secondSuspendingTool);
		const streamFn: PiStreamFn = (_model, context) => {
			const lastMessage = context.messages.at(-1);
			if (lastMessage?.role === 'user') {
				return streamFor(
					assistantMessage(
						[
							{
								type: 'toolCall',
								id: 'complete-call',
								name: completedSibling.name,
								arguments: { owner: 'complete' },
							},
							{
								type: 'toolCall',
								id: 'first-call',
								name: firstSuspendingTool.name,
								arguments: { owner: 'first' },
							},
							{
								type: 'toolCall',
								id: 'second-call',
								name: secondSuspendingTool.name,
								arguments: { owner: 'second' },
							},
						],
						'toolUse',
					),
				);
			}
			if (lastMessage?.role === 'toolResult') {
				modelContinuationCount++;
				continuationToolCallIds = context.messages.flatMap((message) =>
					message.role === 'toolResult' ? [message.toolCallId] : [],
				);
				return streamFor(assistantMessage([{ type: 'text', text: 'Parallel batch finished.' }], 'stop'));
			}
			throw new Error(`Unexpected model history ending in ${lastMessage?.role ?? 'no message'}`);
		};
		const createAdapter = () =>
			new CredentialFreePiAdapter(streamFn, () => {
				modelCreationCount++;
			});
		const destination: Destination = {
			channelId: 'parallel-test-channel' as ChannelId,
			ref: 'parallel-conversation',
		};

		const first = createRuntime({
			snapshotDirectory,
			conversationPath,
			guidancePath,
			adapter: createAdapter(),
			tools,
			sent,
		});
		await startRuntime(first);
		const firstHandle = await first.coordinator.spawn(createAdapter(), {
			guidancePath,
			input: { message: 'Run the parallel batch.' },
			tools,
		});
		await first.conversations.bind(destination, firstHandle.id);
		void firstHandle.start();

		await vi.waitFor(async () => {
			const pending = await first.coordinator.getPendingRequests(firstHandle.id);
			expect(pending.map((request) => request.toolCallId)).toEqual(['first-call', 'second-call']);
			const checkpoint = await first.coordinator.loadCheckpoint(firstHandle.id);
			expect(checkpoint?.toolExecutions).toHaveLength(3);
			expect(
				checkpoint?.toolExecutions.find((execution) => execution.toolCallId === 'complete-call')?.result,
			).toBeDefined();
		});
		const sessionId = firstHandle.id;
		const partialCheckpoint = await first.coordinator.loadCheckpoint(sessionId);
		if (!partialCheckpoint) throw new Error('Expected the partially completed batch checkpoint');
		expect(partialCheckpoint.toolExecutions.map((execution) => execution.toolCallId)).toEqual([
			'complete-call',
			'first-call',
			'second-call',
		]);
		expect(partialCheckpoint.messages.filter((message) => message.role === 'tool_result')).toEqual([]);
		expect(completedSiblingExecutions).toBe(1);
		expect(firstPreparationCount).toBe(1);
		expect(secondPreparationCount).toBe(1);
		expect(modelContinuationCount).toBe(0);

		await first.router.stop();
		await first.coordinator.shutdown();
		await first.conversations.stop();

		const second = createRuntime({
			snapshotDirectory,
			conversationPath,
			guidancePath,
			adapter: createAdapter(),
			tools,
			sent,
		});
		await startRuntime(second);
		expect(second.conversations.getByAgent(sessionId)?.destination).toEqual(destination);
		const restoredRequests = await second.coordinator.getPendingRequests(sessionId);
		expect(restoredRequests.map((request) => request.toolCallId)).toEqual(['first-call', 'second-call']);
		const firstRequest = restoredRequests.find((request) => request.toolCallId === 'first-call');
		const secondRequest = restoredRequests.find((request) => request.toolCallId === 'second-call');
		if (!firstRequest || !secondRequest) throw new Error('Expected both restored suspensions');

		const laterSourceResolution = second.coordinator.resolveSuspensions(
			sessionId,
			[
				{
					suspensionId: secondRequest.suspensionId,
					type: 'event',
					payload: { sequence: 2 },
				},
			],
			createAdapter(),
			{ tools },
		);
		const earlierSourceResolution = second.coordinator.resolveSuspensions(
			sessionId,
			[
				{
					suspensionId: firstRequest.suspensionId,
					type: 'event',
					payload: { sequence: 1 },
				},
			],
			createAdapter(),
			{ tools },
		);
		const [laterHandle, earlierHandle] = await Promise.all([laterSourceResolution, earlierSourceResolution]);
		expect(laterHandle).toBe(earlierHandle);
		const result = await laterHandle.wait();
		expect(result).toMatchObject({ status: 'completed', output: 'Parallel batch finished.' });

		await vi.waitFor(async () => {
			const checkpoint = await second.coordinator.loadCheckpoint(sessionId);
			expect(checkpoint?.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'Parallel batch finished.' }]);
		});
		const finalCheckpoint = await second.coordinator.loadCheckpoint(sessionId);
		if (!finalCheckpoint) throw new Error('Expected the completed parallel batch checkpoint');
		expect(
			finalCheckpoint.messages
				.filter((message) => message.role === 'tool_result')
				.map((message) => message.toolCallId),
		).toEqual(['complete-call', 'first-call', 'second-call']);
		const resultOutput = (toolCallId: string): unknown => {
			const message = finalCheckpoint.messages.find(
				(candidate) => candidate.role === 'tool_result' && candidate.toolCallId === toolCallId,
			);
			const content = message?.content[0];
			if (content?.type !== 'text') throw new Error(`Expected text result for ${toolCallId}`);
			return JSON.parse(content.text) as unknown;
		};
		expect(resultOutput('complete-call')).toEqual({ completed: true, owner: 'complete' });
		expect(resultOutput('first-call')).toEqual({
			owner: 'first',
			prepared: 'first-prepared',
			event: { sequence: 1 },
		});
		expect(resultOutput('second-call')).toEqual({
			owner: 'second',
			prepared: 'second-prepared',
			event: { sequence: 2 },
		});
		expect(finalCheckpoint.toolExecutions).toEqual([]);
		expect(await second.coordinator.getPendingRequests(sessionId)).toEqual([]);
		expect(continuationToolCallIds).toEqual(['complete-call', 'first-call', 'second-call']);
		expect(modelContinuationCount).toBe(1);
		expect(completedSiblingExecutions).toBe(1);
		expect(firstPreparationCount).toBe(1);
		expect(secondPreparationCount).toBe(1);
		expect(modelCreationCount).toBe(2);

		await second.router.stop();
		await second.coordinator.shutdown();
		await second.conversations.stop();
	});

	it('parks a recovered continuation that suspends again without consuming triggering input', async () => {
		temporaryDirectory = await mkdtemp(join(tmpdir(), 'genii-continuation-resuspend-'));
		const snapshotDirectory = join(temporaryDirectory, 'snapshots');
		const conversationPath = join(temporaryDirectory, 'conversations.json');
		const guidancePath = join(temporaryDirectory, 'guidance');
		await mkdir(guidancePath, { recursive: true });

		let afterCrash = false;
		let interruptedContinuationCount = 0;
		let recoveredContinuationCount = 0;
		let resumedContinuationCount = 0;
		let unexpectedInboundCount = 0;
		const sent: SentIntent[] = [];
		const interruptedContinuation = new TestEventStream();
		const firstTool: Tool<unknown, unknown> = {
			name: 'first-restart-wait',
			description: 'Create the continuation marker before restart',
			parameters: { type: 'object', properties: {} } as unknown as Tool<unknown, unknown>['parameters'],
			canSuspend: true,
			execute: async (_input, context) => {
				const event = await context.step.waitForEvent('first.finished');
				return { status: 'success', output: event };
			},
		};
		const secondTool: Tool<unknown, unknown> = {
			name: 'second-restart-wait',
			description: 'Suspend the recovered model continuation again',
			parameters: { type: 'object', properties: {} } as unknown as Tool<unknown, unknown>['parameters'],
			canSuspend: true,
			execute: async (_input, context) => {
				const event = await context.step.waitForEvent('second.finished');
				return { status: 'success', output: event };
			},
		};
		const tools = createToolRegistryWith({}, firstTool, secondTool);
		const streamFn: PiStreamFn = (_model, context) => {
			const lastMessage = context.messages.at(-1);
			if (lastMessage?.role === 'user') {
				if (afterCrash) {
					unexpectedInboundCount++;
					return streamFor(assistantMessage([{ type: 'text', text: 'Unexpected inbound turn.' }], 'stop'));
				}
				return streamFor(
					assistantMessage(
						[{ type: 'toolCall', id: 'first-restart-call', name: firstTool.name, arguments: {} }],
						'toolUse',
					),
				);
			}
			if (lastMessage?.role === 'toolResult' && !afterCrash) {
				interruptedContinuationCount++;
				return interruptedContinuation as unknown as StreamReturn;
			}
			if (lastMessage?.role === 'toolResult' && lastMessage.toolCallId === 'first-restart-call') {
				recoveredContinuationCount++;
				return streamFor(
					assistantMessage(
						[{ type: 'toolCall', id: 'second-restart-call', name: secondTool.name, arguments: {} }],
						'toolUse',
					),
				);
			}
			if (lastMessage?.role === 'toolResult' && lastMessage.toolCallId === 'second-restart-call') {
				resumedContinuationCount++;
				return streamFor(assistantMessage([{ type: 'text', text: 'Second wait completed.' }], 'stop'));
			}
			throw new Error(`Unexpected model history ending in ${lastMessage?.role ?? 'no message'}`);
		};
		const createAdapter = () => new CredentialFreePiAdapter(streamFn, () => {});
		const destination: Destination = {
			channelId: 'resuspend-test-channel' as ChannelId,
			ref: 'resuspend-conversation',
		};

		const first = createRuntime({
			snapshotDirectory,
			conversationPath,
			guidancePath,
			adapter: createAdapter(),
			tools,
			sent,
		});
		await startRuntime(first);
		const firstHandle = await first.coordinator.spawn(createAdapter(), {
			guidancePath,
			input: { message: 'Begin the restart sequence.' },
			tools,
		});
		await first.conversations.bind(destination, firstHandle.id);
		void firstHandle.start();

		await vi.waitFor(() => expect(firstHandle.getPendingRequests()).toHaveLength(1));
		const [firstPending] = firstHandle.getPendingRequests();
		if (!firstPending) throw new Error('Expected the first suspension');
		await firstHandle.resolve([
			{ suspensionId: firstPending.suspensionId, type: 'event', payload: { first: 'done' } },
		]);
		await vi.waitFor(async () => {
			const savedCheckpoint = await first.coordinator.loadCheckpoint(firstHandle.id);
			expect(savedCheckpoint?.phase).toBe('continuation_pending');
			expect(savedCheckpoint?.toolExecutions.every((execution) => execution.result !== undefined)).toBe(true);
		});
		const sessionId = firstHandle.id;
		expect(interruptedContinuationCount).toBe(1);

		await first.router.stop();
		await first.conversations.stop();
		afterCrash = true;

		const second = createRuntime({
			snapshotDirectory,
			conversationPath,
			guidancePath,
			adapter: createAdapter(),
			tools,
			sent,
		});
		await startRuntime(second);
		const inbound: InboundEvent = {
			type: 'message_received',
			origin: { ...destination, metadata: { conversationType: 'direct' } },
			author: { id: 'resuspend-user', username: 'resuspend-user', isBot: false },
			content: { type: 'text', text: 'This input must remain unconsumed.' },
			timestamp: Date.now(),
		};

		await second.router.handleInbound(inbound, destination.channelId);

		const waitingHandle = second.coordinator.get(sessionId);
		if (!waitingHandle) throw new Error('Expected the recovered waiting handle');
		expect(waitingHandle.status).toBe('waiting');
		expect(waitingHandle.getPendingRequests()).toMatchObject([
			{ toolCallId: 'second-restart-call', status: 'waiting' },
		]);
		const parkedCheckpoint = await second.coordinator.loadCheckpoint(sessionId);
		expect(parkedCheckpoint?.phase).toBe('batch_pending');
		expect(parkedCheckpoint?.toolExecutions).toMatchObject([
			{ toolCallId: 'second-restart-call', suspendedStep: { status: 'waiting' } },
		]);
		expect(
			parkedCheckpoint?.messages
				.filter((message) => message.role === 'user')
				.flatMap((message) =>
					message.content.flatMap((content) => (content.type === 'text' ? [content.text] : [])),
				),
		).toEqual(['Begin the restart sequence.']);
		expect(recoveredContinuationCount).toBe(1);
		expect(unexpectedInboundCount).toBe(0);
		expect(
			sent.some(
				({ intent }) =>
					intent.type === 'agent_responding' &&
					intent.content.type === 'text' &&
					intent.content.text.includes('waiting'),
			),
		).toBe(true);

		const [secondPending] = waitingHandle.getPendingRequests();
		if (!secondPending) throw new Error('Expected the second suspension');
		await second.coordinator.resolveSuspensions(
			sessionId,
			[{ suspensionId: secondPending.suspensionId, type: 'event', payload: { second: 'done' } }],
			createAdapter(),
			{ tools },
		);
		await expect(waitingHandle.wait()).resolves.toMatchObject({
			status: 'completed',
			output: 'Second wait completed.',
		});
		await vi.waitFor(async () => {
			const finalCheckpoint = await second.coordinator.loadCheckpoint(sessionId);
			expect(finalCheckpoint?.toolExecutions).toEqual([]);
			expect(finalCheckpoint?.messages.at(-1)?.content).toEqual([
				{ type: 'text', text: 'Second wait completed.' },
			]);
		});
		expect(recoveredContinuationCount).toBe(1);
		expect(resumedContinuationCount).toBe(1);
		expect(unexpectedInboundCount).toBe(0);

		await second.router.stop();
		await second.coordinator.shutdown({ graceful: false, timeoutMs: 1000 });
		await second.conversations.stop();
	});

	it('recovers a committed batch marker before processing new conversation input', async () => {
		temporaryDirectory = await mkdtemp(join(tmpdir(), 'genii-continuation-marker-'));
		const snapshotDirectory = join(temporaryDirectory, 'snapshots');
		const conversationPath = join(temporaryDirectory, 'conversations.json');
		const guidancePath = join(temporaryDirectory, 'guidance');
		await mkdir(guidancePath, { recursive: true });

		let afterCrash = false;
		let completedSiblingExecutions = 0;
		let waitingToolInvocations = 0;
		let preparationCount = 0;
		let interruptedContinuationCount = 0;
		let recoveredContinuationCount = 0;
		let inboundTurnCount = 0;
		const recoveredModelOrder: string[] = [];
		const sent: SentIntent[] = [];
		const interruptedContinuation = new TestEventStream();
		const completedSibling: Tool<unknown, unknown> = {
			name: 'marker-completed-sibling',
			description: 'Complete before the durable sibling resumes',
			parameters: { type: 'object', properties: {} } as unknown as Tool<unknown, unknown>['parameters'],
			execute: async () => {
				completedSiblingExecutions++;
				return { status: 'success', output: 'completed-before-crash' };
			},
		};
		const waitingTool: Tool<unknown, unknown> = {
			name: 'marker-waiting-sibling',
			description: 'Suspend once so the completed batch receives a durable marker',
			parameters: { type: 'object', properties: {} } as unknown as Tool<unknown, unknown>['parameters'],
			canSuspend: true,
			execute: async (_input, context) => {
				waitingToolInvocations++;
				const prepared = await context.step.run('prepare-marker', async () => {
					preparationCount++;
					return 'prepared-once';
				});
				const event = await context.step.waitForEvent('marker.finished');
				return { status: 'success', output: { prepared, event } };
			},
		};
		const tools = createToolRegistryWith({}, completedSibling, waitingTool);
		const streamFn: PiStreamFn = (_model, context) => {
			const lastMessage = context.messages.at(-1);
			if (lastMessage?.role === 'user' && !afterCrash) {
				return streamFor(
					assistantMessage(
						[
							{
								type: 'toolCall',
								id: 'marker-completed-call',
								name: completedSibling.name,
								arguments: {},
							},
							{
								type: 'toolCall',
								id: 'marker-waiting-call',
								name: waitingTool.name,
								arguments: {},
							},
						],
						'toolUse',
					),
				);
			}
			if (lastMessage?.role === 'toolResult' && !afterCrash) {
				interruptedContinuationCount++;
				return interruptedContinuation as unknown as StreamReturn;
			}
			if (lastMessage?.role === 'toolResult') {
				recoveredContinuationCount++;
				recoveredModelOrder.push('recovered-continuation');
				return streamFor(assistantMessage([{ type: 'text', text: 'Recovered committed batch.' }], 'stop'));
			}
			if (lastMessage?.role === 'user') {
				inboundTurnCount++;
				recoveredModelOrder.push('inbound-turn');
				return streamFor(assistantMessage([{ type: 'text', text: 'Processed input after recovery.' }], 'stop'));
			}
			throw new Error(`Unexpected model history ending in ${lastMessage?.role ?? 'no message'}`);
		};
		const createAdapter = () => new CredentialFreePiAdapter(streamFn, () => {});
		const destination: Destination = {
			channelId: 'marker-test-channel' as ChannelId,
			ref: 'marker-conversation',
		};

		const first = createRuntime({
			snapshotDirectory,
			conversationPath,
			guidancePath,
			adapter: createAdapter(),
			tools,
			sent,
		});
		await startRuntime(first);
		const firstHandle = await first.coordinator.spawn(createAdapter(), {
			guidancePath,
			input: { message: 'Create a committed batch marker.' },
			tools,
		});
		await first.conversations.bind(destination, firstHandle.id);
		void firstHandle.start();

		await vi.waitFor(() => expect(firstHandle.getPendingRequests()).toHaveLength(1));
		const [pending] = firstHandle.getPendingRequests();
		if (!pending) throw new Error('Expected the marker-producing suspension');
		await firstHandle.resolve([
			{
				suspensionId: pending.suspensionId,
				type: 'event',
				payload: { marker: 'complete' },
			},
		]);

		await vi.waitFor(async () => {
			expect(interruptedContinuationCount).toBe(1);
			const checkpoint = await first.coordinator.loadCheckpoint(firstHandle.id);
			expect(checkpoint?.phase).toBe('continuation_pending');
			expect(checkpoint?.toolExecutions).toHaveLength(2);
			expect(checkpoint?.toolExecutions.every((execution) => execution.result !== undefined)).toBe(true);
			expect(
				checkpoint?.messages
					.filter((message) => message.role === 'tool_result')
					.map((message) => message.toolCallId),
			).toEqual(['marker-completed-call', 'marker-waiting-call']);
		});
		const sessionId = firstHandle.id;
		expect(completedSiblingExecutions).toBe(1);
		expect(waitingToolInvocations).toBe(2);
		expect(preparationCount).toBe(1);

		// Leave the first coordinator's provider request unresolved to model an
		// abrupt process loss without writing a newer terminal checkpoint.
		await first.router.stop();
		await first.conversations.stop();
		afterCrash = true;

		const second = createRuntime({
			snapshotDirectory,
			conversationPath,
			guidancePath,
			adapter: createAdapter(),
			tools,
			sent,
		});
		await startRuntime(second);
		expect(second.conversations.getByDestination(destination)?.agentId).toBe(sessionId);
		const inbound: InboundEvent = {
			type: 'message_received',
			origin: {
				...destination,
				metadata: { conversationType: 'direct' },
			},
			author: { id: 'marker-user', username: 'marker-user', isBot: false },
			content: { type: 'text', text: 'Handle this only after recovering the batch.' },
			timestamp: Date.now(),
		};
		await second.router.handleInbound(inbound, destination.channelId);

		await vi.waitFor(async () => {
			expect(recoveredModelOrder).toEqual(['recovered-continuation', 'inbound-turn']);
			const checkpoint = await second.coordinator.loadCheckpoint(sessionId);
			expect(checkpoint?.messages.at(-1)?.content).toEqual([
				{ type: 'text', text: 'Processed input after recovery.' },
			]);
		});
		const finalCheckpoint = await second.coordinator.loadCheckpoint(sessionId);
		if (!finalCheckpoint) throw new Error('Expected the post-recovery checkpoint');
		expect(finalCheckpoint.session.id).toBe(sessionId);
		expect(finalCheckpoint.phase).toBeUndefined();
		expect(second.conversations.getByDestination(destination)?.agentId).toBe(sessionId);
		expect(finalCheckpoint.toolExecutions).toEqual([]);
		expect(
			finalCheckpoint.messages
				.filter((message) => message.role === 'tool_result')
				.map((message) => message.toolCallId),
		).toEqual(['marker-completed-call', 'marker-waiting-call']);
		expect(
			finalCheckpoint.messages
				.filter((message) => message.role === 'assistant')
				.flatMap((message) =>
					message.content.flatMap((content) => (content.type === 'text' ? [content.text] : [])),
				),
		).toEqual(['Recovered committed batch.', 'Processed input after recovery.']);
		expect(
			finalCheckpoint.messages
				.filter((message) => message.role === 'user')
				.flatMap((message) =>
					message.content.flatMap((content) => (content.type === 'text' ? [content.text] : [])),
				),
		).toEqual(['Create a committed batch marker.', 'Handle this only after recovering the batch.']);
		expect(recoveredContinuationCount).toBe(1);
		expect(inboundTurnCount).toBe(1);
		expect(completedSiblingExecutions).toBe(1);
		expect(waitingToolInvocations).toBe(2);
		expect(preparationCount).toBe(1);
		const responseTexts = sent.flatMap(({ intent }) =>
			intent.type === 'agent_responding' && intent.content.type === 'text' ? [intent.content.text] : [],
		);
		expect(responseTexts).toEqual(['Recovered committed batch.', 'Processed input after recovery.']);

		await second.router.stop();
		await second.coordinator.shutdown();
		await second.conversations.stop();
	});
});
