/**
 * Tests for MessageRouter toolRegistry passing to coordinator.continue().
 */

import type { Destination } from '@geniigotchi/comms/destination/types';
import type { InboundEvent } from '@geniigotchi/comms/events/types';
import type { ChannelRegistry } from '@geniigotchi/comms/registry/types';
import type { ChannelId } from '@geniigotchi/comms/types/core';
import type { AgentAdapter } from '@geniigotchi/orchestrator/adapters/types';
import type { ContinueConfig, Coordinator } from '@geniigotchi/orchestrator/coordinator/types';
import type { AgentHandle } from '@geniigotchi/orchestrator/handle/types';
import type { AgentCheckpoint } from '@geniigotchi/orchestrator/snapshot/types';
import type { ToolRegistryInterface } from '@geniigotchi/orchestrator/tools/types';
import type { AgentInput, AgentSessionId, AgentSpawnConfig } from '@geniigotchi/orchestrator/types/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
function createMockAgentHandle(id: AgentSessionId, status: 'running' | 'completed' = 'running'): AgentHandle {
	return {
		id,
		status,
		config: { guidancePath: '/test/guidance' },
		createdAt: new Date(),
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
	spawnMock: ReturnType<typeof vi.fn>;
	loadCheckpointMock: ReturnType<typeof vi.fn>;
} {
	const continueMock = vi.fn<[AgentSessionId, AgentInput, AgentAdapter, ContinueConfig?], Promise<AgentHandle>>();
	const spawnMock = vi.fn<[AgentAdapter, AgentSpawnConfig], Promise<AgentHandle>>();
	const loadCheckpointMock = vi.fn<[AgentSessionId], Promise<AgentCheckpoint | null>>();

	return {
		start: vi.fn().mockResolvedValue(undefined),
		shutdown: vi.fn().mockResolvedValue(undefined),
		spawn: spawnMock,
		continue: continueMock,
		get: vi.fn(),
		getAdapter: vi.fn(),
		list: vi.fn().mockReturnValue([]),
		listCheckpoints: vi.fn().mockResolvedValue([]),
		loadCheckpoint: loadCheckpointMock,
		subscribe: vi.fn().mockReturnValue(() => {}),
		status: 'running',
		continueMock,
		spawnMock,
		loadCheckpointMock,
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
		provider: 'mock',
		model: 'mock-model',
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
					memories: [],
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
					memories: [],
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
