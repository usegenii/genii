import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Destination } from '@genii/comms/destination/types';
import type { OutboundIntent } from '@genii/comms/events/types';
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
		await acceptedHandle.resolve([resolution]);
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
});
