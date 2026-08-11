/**
 * Tests for MessageRouter toolRegistry passing to coordinator.continue().
 */

import type { Destination } from '@genii/comms/destination/types';
import type { InboundEvent } from '@genii/comms/events/types';
import type { ChannelRegistry } from '@genii/comms/registry/types';
import type { ChannelId } from '@genii/comms/types/core';
import type { AgentAdapter } from '@genii/orchestrator/adapters/types';
import type { Coordinator } from '@genii/orchestrator/coordinator/types';
import type { AgentHandle } from '@genii/orchestrator/handle/types';
import type { AgentCheckpoint } from '@genii/orchestrator/snapshot/types';
import type { SuspensionId, ToolRegistryInterface } from '@genii/orchestrator/tools/types';
import type { AgentSessionId } from '@genii/orchestrator/types/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandExecutorInterface } from '../../commands/executor';
import type { ConversationManager } from '../../conversations/manager';
import type { ConversationBinding } from '../../conversations/types';
import type { Logger } from '../../logging/logger';
import { MessageRouter, type MessageRouterConfig } from '../router';

/**
 * Create a minimal mock logger for testing.
 */
function createMockLogger(): Logger {
	const mockLogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(() => mockLogger),
	};
	return mockLogger as unknown as Logger;
}

/**
 * Create a test destination with proper branded types.
 */
function createDestination(channelId: string, ref: string): Destination {
	return { channelId: channelId as ChannelId, ref };
}

/**
 * Create a test agent ID with proper branded type.
 */
function createAgentId(id: string): AgentSessionId {
	return id as AgentSessionId;
}

/**
 * Create a channel ID with proper branded type.
 */
function createChannelId(id: string): ChannelId {
	return id as ChannelId;
}

/**
 * Create a mock agent handle for testing.
 */
function createMockAgentHandle(
	id: AgentSessionId,
	status: 'running' | 'waiting' | 'completed' = 'running',
): AgentHandle {
	return {
		id,
		status,
		config: { guidancePath: '/test/guidance' },
		createdAt: new Date(),
		start: vi.fn(),
		subscribe: vi.fn().mockReturnValue(() => {}),
		events: vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: () => ({
				next: () => Promise.resolve({ done: true, value: undefined }),
			}),
		}),
		send: vi.fn().mockResolvedValue(undefined),
		pause: vi.fn().mockResolvedValue(undefined),
		resume: vi.fn().mockResolvedValue(undefined),
		terminate: vi.fn().mockResolvedValue(undefined),
		wait: vi.fn().mockResolvedValue({
			status: 'completed',
			output: 'done',
			metrics: { durationMs: 100, turns: 1, toolCalls: 0 },
		}),
		snapshot: vi.fn().mockReturnValue({
			id: 'snapshot-1',
			sessionId: id,
			timestamp: Date.now(),
			status,
			metrics: { durationMs: 100, turns: 1, toolCalls: 0 },
		}),
		getPendingRequests: vi.fn().mockReturnValue([]),
		resolve: vi.fn().mockResolvedValue(undefined),
	};
}

/**
 * Create a mock coordinator for testing.
 */
function createMockCoordinator(): Coordinator & {
	continueMock: ReturnType<typeof vi.fn>;
	resumeContinuationMock: ReturnType<typeof vi.fn>;
	spawnMock: ReturnType<typeof vi.fn>;
	loadCheckpointMock: ReturnType<typeof vi.fn>;
	getPendingRequestsMock: ReturnType<typeof vi.fn>;
} {
	const continueMock = vi.fn();
	const resumeContinuationMock = vi.fn();
	const spawnMock = vi.fn();
	const loadCheckpointMock = vi.fn();
	const getPendingRequestsMock = vi.fn().mockResolvedValue([]);

	return {
		start: vi.fn().mockResolvedValue(undefined),
		shutdown: vi.fn().mockResolvedValue(undefined),
		spawn: spawnMock,
		continue: continueMock,
		resumeContinuation: resumeContinuationMock,
		getPendingRequests: getPendingRequestsMock,
		restoreSuspended: vi.fn(),
		resolveSuspensions: vi.fn(),
		get: vi.fn(),
		getAdapter: vi.fn(),
		list: vi.fn().mockReturnValue([]),
		listCheckpoints: vi.fn().mockResolvedValue([]),
		loadCheckpoint: loadCheckpointMock,
		subscribe: vi.fn().mockReturnValue(() => {}),
		status: 'running',
		continueMock,
		resumeContinuationMock,
		spawnMock,
		loadCheckpointMock,
		getPendingRequestsMock,
	};
}

/**
 * Create a mock channel registry for testing.
 */
function createMockChannelRegistry(): ChannelRegistry {
	return {
		register: vi.fn(),
		unregister: vi.fn(),
		get: vi.fn(),
		list: vi.fn().mockReturnValue([]),
		subscribe: vi.fn().mockReturnValue(() => {}),
		events: vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: () => ({
				next: () => Promise.resolve({ done: true, value: undefined }),
			}),
		}),
		process: vi.fn().mockResolvedValue({
			intentType: 'agent_responding',
			success: true,
			timestamp: Date.now(),
		}),
	};
}

/**
 * Create a mock conversation manager for testing.
 */
function createMockConversationManager(): ConversationManager {
	const bindings = new Map<string, ConversationBinding>();

	return {
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		getOrCreate: vi.fn((destination: Destination) => {
			const key = `${destination.channelId}:${destination.ref}`;
			if (!bindings.has(key)) {
				bindings.set(key, {
					destination,
					agentId: null,
					createdAt: new Date(),
					lastActivityAt: new Date(),
				});
			}
			const binding = bindings.get(key);
			if (!binding) {
				throw new Error(`Binding not found for key: ${key}`);
			}
			return binding;
		}),
		bind: vi.fn((destination: Destination, agentId: AgentSessionId) => {
			const key = `${destination.channelId}:${destination.ref}`;
			const binding = bindings.get(key) ?? {
				destination,
				agentId: null,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			};
			binding.agentId = agentId;
			bindings.set(key, binding);
		}),
		unbind: vi.fn((destination: Destination) => {
			const key = `${destination.channelId}:${destination.ref}`;
			const binding = bindings.get(key);
			if (binding) {
				binding.agentId = null;
			}
		}),
		getByDestination: vi.fn((destination: Destination) => {
			const key = `${destination.channelId}:${destination.ref}`;
			return bindings.get(key);
		}),
		getByAgent: vi.fn(),
		list: vi.fn().mockReturnValue([]),
		snapshot: vi.fn().mockReturnValue([]),
		restore: vi.fn(),
		activeCount: 0,
		totalCount: 0,
	} as unknown as ConversationManager;
}

/**
 * Create a mock adapter for testing.
 */
function createMockAdapter(): AgentAdapter {
	return {
		name: 'mock-adapter',
		modelProvider: 'mock',
		modelName: 'mock-model',
		create: vi.fn(),
		restore: vi.fn(),
	};
}

/**
 * Create a mock tool registry for testing.
 */
function createMockToolRegistry(): ToolRegistryInterface {
	return {
		register: vi.fn(),
		get: vi.fn(),
		all: vi.fn().mockReturnValue([]),
		byCategory: vi.fn().mockReturnValue([]),
		extend: vi.fn(),
	};
}

/**
 * Create a mock inbound message event.
 */
function createMessageEvent(channelId: string, ref: string, text: string): InboundEvent {
	return {
		type: 'message_received',
		origin: {
			channelId: channelId as ChannelId,
			ref,
			metadata: {
				conversationType: 'direct',
			},
		},
		author: {
			id: 'user-123',
			username: 'testuser',
			isBot: false,
		},
		content: {
			type: 'text',
			text,
		},
		timestamp: Date.now(),
	} as InboundEvent;
}

function createCommandEvent(channelId: string, ref: string, command: string): InboundEvent {
	return {
		type: 'command_received',
		origin: {
			channelId: channelId as ChannelId,
			ref,
			metadata: { conversationType: 'direct' },
		},
		author: {
			id: 'user-123',
			username: 'testuser',
			isBot: false,
		},
		command,
		args: '',
		timestamp: Date.now(),
	} as InboundEvent;
}

describe('MessageRouter', () => {
	let mockLogger: Logger;
	let mockCoordinator: ReturnType<typeof createMockCoordinator>;
	let mockChannelRegistry: ChannelRegistry;
	let mockConversationManager: ConversationManager;
	let mockToolRegistry: ToolRegistryInterface;
	let mockAdapterFactory: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockLogger = createMockLogger();
		mockCoordinator = createMockCoordinator();
		mockChannelRegistry = createMockChannelRegistry();
		mockConversationManager = createMockConversationManager();
		mockToolRegistry = createMockToolRegistry();
		mockAdapterFactory = vi.fn().mockResolvedValue(createMockAdapter());
	});

	function createRouter(overrides: Partial<MessageRouterConfig> = {}): MessageRouter {
		return new MessageRouter({
			coordinator: mockCoordinator,
			channelRegistry: mockChannelRegistry,
			conversationManager: mockConversationManager,
			adapterFactory: mockAdapterFactory,
			defaultSpawnContext: {
				guidancePath: '/test/guidance',
			},
			logger: mockLogger,
			toolRegistry: mockToolRegistry,
			...overrides,
		});
	}

	describe('destination serialization', () => {
		it('keeps a command mutation ahead of simultaneous ordinary input', async () => {
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const oldAgentId = createAgentId('old-agent');
			const newAgentId = createAgentId('new-agent');
			const oldHandle = createMockAgentHandle(oldAgentId, 'running');
			const newHandle = createMockAgentHandle(newAgentId, 'running');
			const binding: ConversationBinding = {
				destination,
				agentId: oldAgentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue(binding);
			mockConversationManager.bind = vi.fn(async (_destination, agentId) => {
				binding.agentId = agentId;
			});
			mockCoordinator.get = vi.fn().mockReturnValue(oldHandle);
			mockCoordinator.spawnMock.mockResolvedValue(newHandle);

			let markCommandStarted: () => void = () => undefined;
			let releaseCommand: () => void = () => undefined;
			const commandStarted = new Promise<void>((resolve) => {
				markCommandStarted = resolve;
			});
			const commandGate = new Promise<void>((resolve) => {
				releaseCommand = resolve;
			});
			const commandExecutor: CommandExecutorInterface = {
				execute: vi.fn(async () => {
					markCommandStarted();
					await commandGate;
					await oldHandle.terminate('start a new conversation');
					binding.agentId = null;
					return { type: 'silent' as const };
				}),
			};
			const router = createRouter({ commandExecutor });

			const command = router.handleInbound(createCommandEvent('test-channel', 'user-123', 'new'), channelId);
			await commandStarted;
			const message = router.handleInbound(
				createMessageEvent('test-channel', 'user-123', 'after new'),
				channelId,
			);
			await Promise.resolve();

			expect(mockCoordinator.spawnMock).not.toHaveBeenCalled();
			expect(oldHandle.send).not.toHaveBeenCalled();

			releaseCommand();
			await Promise.all([command, message]);

			expect(oldHandle.terminate).toHaveBeenCalledTimes(1);
			expect(mockCoordinator.spawnMock).toHaveBeenCalledTimes(1);
			expect(mockCoordinator.spawnMock).toHaveBeenCalledWith(
				expect.any(Object),
				expect.objectContaining({ input: expect.objectContaining({ message: 'after new' }) }),
			);
			expect(vi.mocked(oldHandle.terminate).mock.invocationCallOrder[0]).toBeLessThan(
				mockCoordinator.spawnMock.mock.invocationCallOrder[0] as number,
			);
			expect(oldHandle.send).not.toHaveBeenCalled();
		});

		it('drains accepted destination work and rejects new inbound work during stop', async () => {
			const channelId = createChannelId('test-channel');
			let markCommandStarted: () => void = () => undefined;
			let releaseCommand: () => void = () => undefined;
			const commandStarted = new Promise<void>((resolve) => {
				markCommandStarted = resolve;
			});
			const commandGate = new Promise<void>((resolve) => {
				releaseCommand = resolve;
			});
			const commandExecutor: CommandExecutorInterface = {
				execute: vi.fn(async () => {
					markCommandStarted();
					await commandGate;
					return { type: 'silent' as const };
				}),
			};
			const router = createRouter({ commandExecutor });
			await router.start();

			const accepted = router.handleInbound(createCommandEvent('test-channel', 'user-123', 'new'), channelId);
			await commandStarted;
			let stopSettled = false;
			const stop = router.stop().then(() => {
				stopSettled = true;
			});
			await new Promise<void>((resolve) => setImmediate(resolve));

			expect(stopSettled).toBe(false);
			await expect(
				router.handleInbound(createMessageEvent('test-channel', 'user-123', 'too late'), channelId),
			).rejects.toThrow('not accepting inbound events');

			releaseCommand();
			await accepted;
			await stop;
			expect(stopSettled).toBe(true);
		});
	});

	describe('waiting sessions', () => {
		it('rejects ordinary chat input for a live waiting agent', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');
			const waitingHandle = createMockAgentHandle(agentId, 'waiting');
			mockCoordinator.get = vi.fn().mockReturnValue(waitingHandle);
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue({
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			});

			await router.handleInbound(createMessageEvent('test-channel', 'user-123', 'hello?'), channelId);

			expect(waitingHandle.send).not.toHaveBeenCalled();
			expect(mockCoordinator.continueMock).not.toHaveBeenCalled();
			expect(mockChannelRegistry.process).toHaveBeenCalledWith(
				channelId,
				expect.objectContaining({
					content: expect.objectContaining({ text: expect.stringContaining('waiting') }),
				}),
			);
		});

		it('inspects a dormant checkpoint without restoring or replacing a waiting session', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');
			const checkpoint: AgentCheckpoint = {
				timestamp: Date.now(),
				adapterName: 'mock-adapter',
				session: {
					id: agentId,
					createdAt: Date.now(),
					tags: [],
					metadata: {},
					metrics: { durationMs: 0, turns: 0, toolCalls: 0 },
				},
				guidance: { guidancePath: '/test/guidance', memoryWrites: [], systemState: {} },
				messages: [],
				adapterConfig: { provider: 'mock', model: 'mock-model' },
				toolExecutions: [],
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue({
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			});
			mockCoordinator.get = vi.fn().mockReturnValue(undefined);
			mockCoordinator.loadCheckpointMock.mockResolvedValue(checkpoint);
			mockCoordinator.getPendingRequestsMock.mockResolvedValue([{ status: 'waiting' }]);

			await router.handleInbound(createMessageEvent('test-channel', 'user-123', 'hello?'), channelId);

			expect(mockCoordinator.getPendingRequestsMock).toHaveBeenCalledWith(agentId);
			expect(mockAdapterFactory).not.toHaveBeenCalled();
			expect(mockCoordinator.continueMock).not.toHaveBeenCalled();
			expect(mockCoordinator.spawnMock).not.toHaveBeenCalled();
			expect(mockConversationManager.unbind).not.toHaveBeenCalled();
		});
	});

	describe('handleInbound with completed agent', () => {
		it('should pass toolRegistry to coordinator.continue() when continuing a completed agent', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');

			// Create a completed agent handle
			const completedHandle = createMockAgentHandle(agentId, 'completed');

			// Set up the coordinator to return the completed handle
			mockCoordinator.get = vi.fn().mockReturnValue(completedHandle);
			mockCoordinator.getAdapter = vi.fn().mockReturnValue(createMockAdapter());

			// Set up continue to return a new handle
			const newHandle = createMockAgentHandle(agentId, 'running');
			mockCoordinator.continueMock.mockResolvedValue(newHandle);

			// Set up conversation manager to return a binding with the agent
			const binding: ConversationBinding = {
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue(binding);

			// Create a message event
			const event = createMessageEvent('test-channel', 'user-123', 'Hello again!');

			// Handle the inbound event
			await router.handleInbound(event, channelId);

			// Verify coordinator.continue was called with the toolRegistry
			expect(mockCoordinator.continueMock).toHaveBeenCalledTimes(1);
			expect(mockCoordinator.continueMock).toHaveBeenCalledWith(
				agentId,
				expect.objectContaining({
					message: 'Hello again!',
				}),
				expect.any(Object), // adapter
				expect.objectContaining({
					tools: mockToolRegistry,
				}),
			);
		});

		it('should handle continue failure gracefully and unbind destination', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');

			// Create a completed agent handle
			const completedHandle = createMockAgentHandle(agentId, 'completed');

			// Set up the coordinator to return the completed handle
			mockCoordinator.get = vi.fn().mockReturnValue(completedHandle);
			mockCoordinator.getAdapter = vi.fn().mockReturnValue(createMockAdapter());

			// Set up continue to throw an error
			mockCoordinator.continueMock.mockRejectedValue(new Error('Continue failed'));

			// Set up conversation manager to return a binding with the agent
			const binding: ConversationBinding = {
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue(binding);

			// Create a message event
			const event = createMessageEvent('test-channel', 'user-123', 'Hello again!');

			// Handle the inbound event - should not throw
			await router.handleInbound(event, channelId);

			// Verify unbind was called (with the origin from the event which includes metadata)
			expect(mockConversationManager.unbind).toHaveBeenCalledWith(
				expect.objectContaining({
					channelId: 'test-channel',
					ref: 'user-123',
				}),
			);
		});
	});

	describe('_tryRestoreFromCheckpoint', () => {
		it('should pass toolRegistry to coordinator.continue() when restoring from checkpoint', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');

			// Create a binding with an agent that is NOT in the coordinator (simulating restart)
			const binding: ConversationBinding = {
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue(binding);

			// Coordinator.get returns undefined (agent not loaded after restart)
			mockCoordinator.get = vi.fn().mockReturnValue(undefined);

			// Set up a checkpoint to restore from
			const checkpoint: AgentCheckpoint = {
				timestamp: Date.now(),
				adapterName: 'mock-adapter',
				session: {
					id: agentId,
					createdAt: Date.now(),
					tags: [],
					metadata: {},
					metrics: { durationMs: 0, turns: 0, toolCalls: 0 },
				},
				guidance: {
					guidancePath: '/test/guidance',
					memoryWrites: [],
					systemState: {},
				},
				messages: [],
				adapterConfig: {
					provider: 'mock',
					model: 'mock-model',
				},
				toolExecutions: [],
			};
			mockCoordinator.loadCheckpointMock.mockResolvedValue(checkpoint);

			// Set up continue to return a new handle
			const newHandle = createMockAgentHandle(agentId, 'running');
			mockCoordinator.continueMock.mockResolvedValue(newHandle);

			// Create a message event
			const event = createMessageEvent('test-channel', 'user-123', 'Hello after restart!');

			// Handle the inbound event
			await router.handleInbound(event, channelId);

			// Verify coordinator.continue was called with the toolRegistry
			expect(mockCoordinator.continueMock).toHaveBeenCalledTimes(1);
			expect(mockAdapterFactory).toHaveBeenCalledWith(agentId, checkpoint);
			expect(mockCoordinator.continueMock).toHaveBeenCalledWith(
				agentId,
				expect.objectContaining({
					message: 'Hello after restart!',
				}),
				expect.any(Object), // adapter
				expect.objectContaining({
					tools: mockToolRegistry,
				}),
			);
		});

		it('recovers a continuation marker before forwarding the triggering input', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');
			const checkpoint: AgentCheckpoint = {
				phase: 'continuation_pending',
				timestamp: Date.now(),
				adapterName: 'mock-adapter',
				session: {
					id: agentId,
					createdAt: Date.now(),
					tags: [],
					metadata: {},
					metrics: { durationMs: 0, turns: 1, toolCalls: 1 },
				},
				guidance: { guidancePath: '/test/guidance', memoryWrites: [], systemState: {} },
				messages: [],
				adapterConfig: { provider: 'mock', model: 'mock-model' },
				toolExecutions: [],
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue({
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			});
			mockCoordinator.get = vi.fn().mockReturnValue(undefined);
			mockCoordinator.loadCheckpointMock.mockResolvedValue(checkpoint);
			const adapter = createMockAdapter();
			mockAdapterFactory.mockResolvedValue(adapter);
			mockCoordinator.resumeContinuationMock.mockResolvedValue(createMockAgentHandle(agentId, 'completed'));
			const continuedHandle = createMockAgentHandle(agentId, 'running');
			mockCoordinator.continueMock.mockResolvedValue(continuedHandle);

			await router.handleInbound(
				createMessageEvent('test-channel', 'user-123', 'Message after recovered continuation'),
				channelId,
			);

			expect(mockCoordinator.getPendingRequestsMock).not.toHaveBeenCalled();
			expect(mockCoordinator.resumeContinuationMock).toHaveBeenCalledWith(agentId, adapter, {
				tools: mockToolRegistry,
			});
			expect(mockCoordinator.continueMock).toHaveBeenCalledWith(
				agentId,
				expect.objectContaining({ message: 'Message after recovered continuation' }),
				adapter,
				{ tools: mockToolRegistry },
			);
			expect(mockCoordinator.resumeContinuationMock.mock.invocationCallOrder[0]).toBeLessThan(
				mockCoordinator.continueMock.mock.invocationCallOrder[0] as number,
			);
			expect(continuedHandle.start).toHaveBeenCalledTimes(1);
		});

		it('recovers an accepted resolution with an unfinished ordinary sibling before either result', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');
			const suspensionId = 'call-waiting:suspended-step' as SuspensionId;
			const checkpoint: AgentCheckpoint = {
				phase: 'batch_pending',
				timestamp: Date.now(),
				adapterName: 'mock-adapter',
				session: {
					id: agentId,
					createdAt: Date.now(),
					tags: [],
					metadata: {},
					metrics: { durationMs: 0, turns: 1, toolCalls: 2 },
				},
				guidance: { guidancePath: '/test/guidance', memoryWrites: [], systemState: {} },
				messages: [],
				adapterConfig: { provider: 'mock', model: 'mock-model' },
				toolExecutions: [
					{
						toolName: 'build',
						toolCallId: 'call-waiting',
						input: { value: 'resolved' },
						completedSteps: [],
						suspendedStep: {
							suspensionId,
							stepId: 'suspended-step',
							request: { type: 'event', eventName: 'build.finished' },
							suspendedAt: 100,
							status: 'resolved',
							resolution: { suspensionId, type: 'event', payload: 'accepted' },
							resumeData: {
								stepId: 'suspended-step',
								outcome: { type: 'value', value: 'accepted' },
							},
						},
					},
					{
						toolName: 'build',
						toolCallId: 'call-sibling',
						input: { value: 'unfinished' },
						completedSteps: [],
					},
				],
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue({
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			});
			mockCoordinator.get = vi.fn().mockReturnValue(undefined);
			mockCoordinator.loadCheckpointMock.mockResolvedValue(checkpoint);
			mockCoordinator.getPendingRequestsMock.mockResolvedValue([
				{
					suspensionId,
					toolCallId: 'call-waiting',
					toolName: 'build',
					stepId: 'suspended-step',
					type: 'event',
					request: { type: 'event', eventName: 'build.finished' },
					suspendedAt: 100,
					status: 'resolved',
				},
			]);
			const adapter = createMockAdapter();
			mockAdapterFactory.mockResolvedValue(adapter);
			mockCoordinator.resumeContinuationMock.mockResolvedValue(createMockAgentHandle(agentId, 'completed'));
			const continuedHandle = createMockAgentHandle(agentId, 'running');
			mockCoordinator.continueMock.mockResolvedValue(continuedHandle);

			await router.handleInbound(
				createMessageEvent('test-channel', 'user-123', 'Message after recovered sibling'),
				channelId,
			);

			expect(mockCoordinator.getPendingRequestsMock).toHaveBeenCalledWith(agentId);
			expect(mockCoordinator.resumeContinuationMock).toHaveBeenCalledWith(agentId, adapter, {
				tools: mockToolRegistry,
			});
			expect(mockCoordinator.continueMock).toHaveBeenCalledWith(
				agentId,
				expect.objectContaining({ message: 'Message after recovered sibling' }),
				adapter,
				{ tools: mockToolRegistry },
			);
			expect(mockCoordinator.resumeContinuationMock.mock.invocationCallOrder[0]).toBeLessThan(
				mockCoordinator.continueMock.mock.invocationCallOrder[0] as number,
			);
		});

		it('parks a re-suspended continuation without consuming input and lets router stop drain', async () => {
			const router = createRouter();
			await router.start();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');
			const checkpoint: AgentCheckpoint = {
				phase: 'continuation_pending',
				timestamp: Date.now(),
				adapterName: 'mock-adapter',
				session: {
					id: agentId,
					createdAt: Date.now(),
					tags: [],
					metadata: {},
					metrics: { durationMs: 0, turns: 1, toolCalls: 1 },
				},
				guidance: { guidancePath: '/test/guidance', memoryWrites: [], systemState: {} },
				messages: [],
				adapterConfig: { provider: 'mock', model: 'mock-model' },
				toolExecutions: [],
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue({
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			});
			mockCoordinator.get = vi.fn().mockReturnValue(undefined);
			mockCoordinator.loadCheckpointMock.mockResolvedValue(checkpoint);
			const adapter = createMockAdapter();
			mockAdapterFactory.mockResolvedValue(adapter);
			const waitingHandle = createMockAgentHandle(agentId, 'waiting');
			let markRecoveryStarted: (() => void) | undefined;
			let releaseRecovery: (() => void) | undefined;
			const recoveryStarted = new Promise<void>((resolve) => {
				markRecoveryStarted = resolve;
			});
			const recoveryGate = new Promise<void>((resolve) => {
				releaseRecovery = resolve;
			});
			mockCoordinator.resumeContinuationMock.mockImplementation(async () => {
				markRecoveryStarted?.();
				await recoveryGate;
				return waitingHandle;
			});

			const inbound = router.handleInbound(
				createMessageEvent('test-channel', 'user-123', 'Do not append this while parked'),
				channelId,
			);
			await recoveryStarted;
			let stopSettled = false;
			const stop = router.stop().then(() => {
				stopSettled = true;
			});
			await Promise.resolve();
			expect(stopSettled).toBe(false);

			releaseRecovery?.();
			await Promise.all([inbound, stop]);

			expect(mockCoordinator.continueMock).not.toHaveBeenCalled();
			expect(waitingHandle.send).not.toHaveBeenCalled();
			expect(mockConversationManager.unbind).not.toHaveBeenCalled();
			expect(mockChannelRegistry.process).toHaveBeenCalledWith(
				channelId,
				expect.objectContaining({
					content: expect.objectContaining({ text: expect.stringContaining('waiting') }),
				}),
			);
			expect(stopSettled).toBe(true);
		});

		it('serializes simultaneous inputs around continuation recovery', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');
			const checkpoint: AgentCheckpoint = {
				phase: 'continuation_pending',
				timestamp: Date.now(),
				adapterName: 'mock-adapter',
				session: {
					id: agentId,
					createdAt: Date.now(),
					tags: [],
					metadata: {},
					metrics: { durationMs: 0, turns: 1, toolCalls: 1 },
				},
				guidance: { guidancePath: '/test/guidance', memoryWrites: [], systemState: {} },
				messages: [],
				adapterConfig: { provider: 'mock', model: 'mock-model' },
				toolExecutions: [],
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue({
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			});
			mockCoordinator.loadCheckpointMock.mockResolvedValue(checkpoint);
			const adapter = createMockAdapter();
			mockAdapterFactory.mockResolvedValue(adapter);

			let releaseRecovery: () => void = () => undefined;
			const recoveryGate = new Promise<void>((resolve) => {
				releaseRecovery = resolve;
			});
			mockCoordinator.resumeContinuationMock.mockImplementation(async () => {
				await recoveryGate;
				return createMockAgentHandle(agentId, 'completed');
			});

			const continuedHandle = createMockAgentHandle(agentId, 'running');
			let liveHandle: AgentHandle | undefined;
			mockCoordinator.get = vi.fn(() => liveHandle);
			mockCoordinator.continueMock.mockImplementation(async () => {
				liveHandle = continuedHandle;
				return continuedHandle;
			});

			const firstInput = router.handleInbound(
				createMessageEvent('test-channel', 'user-123', 'first after restart'),
				channelId,
			);
			await vi.waitFor(() => expect(mockCoordinator.resumeContinuationMock).toHaveBeenCalledTimes(1));
			const secondInput = router.handleInbound(
				createMessageEvent('test-channel', 'user-123', 'second after restart'),
				channelId,
			);

			await Promise.resolve();
			expect(mockCoordinator.loadCheckpointMock).toHaveBeenCalledTimes(1);
			expect(mockCoordinator.continueMock).not.toHaveBeenCalled();

			releaseRecovery();
			await Promise.all([firstInput, secondInput]);

			expect(mockCoordinator.resumeContinuationMock).toHaveBeenCalledTimes(1);
			expect(mockCoordinator.continueMock).toHaveBeenCalledTimes(1);
			expect(mockCoordinator.continueMock).toHaveBeenCalledWith(
				agentId,
				expect.objectContaining({ message: 'first after restart' }),
				adapter,
				{ tools: mockToolRegistry },
			);
			expect(continuedHandle.send).toHaveBeenCalledTimes(1);
			expect(continuedHandle.send).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'second after restart' }),
			);
		});

		it('preserves the binding and does not consume input when marker recovery fails', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');
			const checkpoint: AgentCheckpoint = {
				phase: 'continuation_pending',
				timestamp: Date.now(),
				adapterName: 'mock-adapter',
				session: {
					id: agentId,
					createdAt: Date.now(),
					tags: [],
					metadata: {},
					metrics: { durationMs: 0, turns: 1, toolCalls: 1 },
				},
				guidance: { guidancePath: '/test/guidance', memoryWrites: [], systemState: {} },
				messages: [],
				adapterConfig: { provider: 'mock', model: 'mock-model' },
				toolExecutions: [],
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue({
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			});
			mockCoordinator.get = vi.fn().mockReturnValue(undefined);
			mockCoordinator.loadCheckpointMock.mockResolvedValue(checkpoint);
			mockCoordinator.resumeContinuationMock.mockRejectedValue(new Error('Continuation failed'));

			await router.handleInbound(createMessageEvent('test-channel', 'user-123', 'Do not lose me'), channelId);

			expect(mockCoordinator.continueMock).not.toHaveBeenCalled();
			expect(mockCoordinator.spawnMock).not.toHaveBeenCalled();
			expect(mockConversationManager.unbind).not.toHaveBeenCalled();
		});

		it('should spawn new agent when no checkpoint exists after restart', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');

			// Create a binding with an agent that is NOT in the coordinator (simulating restart)
			const binding: ConversationBinding = {
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue(binding);

			// Coordinator.get returns undefined (agent not loaded after restart)
			mockCoordinator.get = vi.fn().mockReturnValue(undefined);

			// No checkpoint exists
			mockCoordinator.loadCheckpointMock.mockResolvedValue(null);

			// Set up spawn to return a new handle
			const newAgentId = createAgentId('agent-2');
			const newHandle = createMockAgentHandle(newAgentId, 'running');
			mockCoordinator.spawnMock.mockResolvedValue(newHandle);

			// Create a message event
			const event = createMessageEvent('test-channel', 'user-123', 'Hello after restart!');

			// Handle the inbound event
			await router.handleInbound(event, channelId);

			// Verify spawn was called instead of continue
			expect(mockCoordinator.spawnMock).toHaveBeenCalledTimes(1);
			expect(mockCoordinator.continueMock).not.toHaveBeenCalled();

			// Verify unbind was called to remove old binding (with the origin from the event which includes metadata)
			expect(mockConversationManager.unbind).toHaveBeenCalledWith(
				expect.objectContaining({
					channelId: 'test-channel',
					ref: 'user-123',
				}),
			);

			// Verify new binding was created (with the origin from the event which includes metadata)
			expect(mockConversationManager.bind).toHaveBeenCalledWith(
				expect.objectContaining({
					channelId: 'test-channel',
					ref: 'user-123',
				}),
				newAgentId,
			);
		});

		it('should spawn new agent when checkpoint restore fails', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');

			// Create a binding with an agent that is NOT in the coordinator (simulating restart)
			const binding: ConversationBinding = {
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue(binding);

			// Coordinator.get returns undefined (agent not loaded after restart)
			mockCoordinator.get = vi.fn().mockReturnValue(undefined);

			// Checkpoint exists
			const checkpoint: AgentCheckpoint = {
				timestamp: Date.now(),
				adapterName: 'mock-adapter',
				session: {
					id: agentId,
					createdAt: Date.now(),
					tags: [],
					metadata: {},
					metrics: { durationMs: 0, turns: 0, toolCalls: 0 },
				},
				guidance: {
					guidancePath: '/test/guidance',
					memoryWrites: [],
					systemState: {},
				},
				messages: [],
				adapterConfig: {
					provider: 'mock',
					model: 'mock-model',
				},
				toolExecutions: [],
			};
			mockCoordinator.loadCheckpointMock.mockResolvedValue(checkpoint);

			// But continue fails
			mockCoordinator.continueMock.mockRejectedValue(new Error('Restore failed'));

			// Set up spawn to return a new handle
			const newAgentId = createAgentId('agent-2');
			const newHandle = createMockAgentHandle(newAgentId, 'running');
			mockCoordinator.spawnMock.mockResolvedValue(newHandle);

			// Create a message event
			const event = createMessageEvent('test-channel', 'user-123', 'Hello after restart!');

			// Handle the inbound event
			await router.handleInbound(event, channelId);

			// Verify continue was attempted
			expect(mockCoordinator.continueMock).toHaveBeenCalledTimes(1);

			// Verify spawn was called as fallback
			expect(mockCoordinator.spawnMock).toHaveBeenCalledTimes(1);

			// Verify unbind and bind were called for the new agent (with the origin from the event which includes metadata)
			expect(mockConversationManager.unbind).toHaveBeenCalledWith(
				expect.objectContaining({
					channelId: 'test-channel',
					ref: 'user-123',
				}),
			);
			expect(mockConversationManager.bind).toHaveBeenCalledWith(
				expect.objectContaining({
					channelId: 'test-channel',
					ref: 'user-123',
				}),
				newAgentId,
			);
		});
	});

	describe('toolRegistry in spawn', () => {
		it('should pass toolRegistry when spawning a new agent', async () => {
			const router = createRouter();
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');

			// Set up conversation manager to return a binding without an agent
			const binding: ConversationBinding = {
				destination,
				agentId: null,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue(binding);

			// Set up spawn to return a new handle
			const newAgentId = createAgentId('agent-1');
			const newHandle = createMockAgentHandle(newAgentId, 'running');
			mockCoordinator.spawnMock.mockResolvedValue(newHandle);

			// Create a message event
			const event = createMessageEvent('test-channel', 'user-123', 'Hello!');

			// Handle the inbound event
			await router.handleInbound(event, channelId);

			// Verify spawn was called with the toolRegistry
			expect(mockCoordinator.spawnMock).toHaveBeenCalledTimes(1);
			expect(mockCoordinator.spawnMock).toHaveBeenCalledWith(
				expect.any(Object), // adapter
				expect.objectContaining({
					tools: mockToolRegistry,
				}),
			);
		});
	});

	describe('without toolRegistry', () => {
		it('should work without toolRegistry configured', async () => {
			// Create router without toolRegistry
			const router = createRouter({ toolRegistry: undefined });
			const channelId = createChannelId('test-channel');
			const destination = createDestination('test-channel', 'user-123');
			const agentId = createAgentId('agent-1');

			// Create a completed agent handle
			const completedHandle = createMockAgentHandle(agentId, 'completed');

			// Set up the coordinator to return the completed handle
			mockCoordinator.get = vi.fn().mockReturnValue(completedHandle);
			mockCoordinator.getAdapter = vi.fn().mockReturnValue(createMockAdapter());

			// Set up continue to return a new handle
			const newHandle = createMockAgentHandle(agentId, 'running');
			mockCoordinator.continueMock.mockResolvedValue(newHandle);

			// Set up conversation manager to return a binding with the agent
			const binding: ConversationBinding = {
				destination,
				agentId,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			};
			mockConversationManager.getOrCreate = vi.fn().mockReturnValue(binding);

			// Create a message event
			const event = createMessageEvent('test-channel', 'user-123', 'Hello again!');

			// Handle the inbound event
			await router.handleInbound(event, channelId);

			// Verify coordinator.continue was called with undefined tools
			expect(mockCoordinator.continueMock).toHaveBeenCalledTimes(1);
			expect(mockCoordinator.continueMock).toHaveBeenCalledWith(
				agentId,
				expect.any(Object),
				expect.any(Object),
				expect.objectContaining({
					tools: undefined,
				}),
			);
		});
	});
});
