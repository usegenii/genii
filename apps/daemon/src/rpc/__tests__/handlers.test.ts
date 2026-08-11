/**
 * Tests for RPC handlers.
 */

import type { ChannelRegistry } from '@genii/comms/registry/types';
import { createChannelId } from '@genii/comms/types/core';
import type { ModelFactory } from '@genii/models/factory';
import type { Coordinator } from '@genii/orchestrator/coordinator/types';
import type { AgentHandle } from '@genii/orchestrator/handle/types';
import type { AgentCheckpoint } from '@genii/orchestrator/snapshot/types';
import type { ToolRegistryInterface } from '@genii/orchestrator/tools/types';
import { type AgentSessionId, createAgentSessionId } from '@genii/orchestrator/types/core';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationManager } from '../../conversations/manager';
import type { Logger } from '../../logging/logger';
import type { ShutdownManager } from '../../shutdown/manager';
import type { TransportConnection } from '../../transport/types';
import { createHandlers, type DaemonRuntimeConfig, type RpcHandlerContext } from '../handlers';
import type { SubscriptionManager } from '../subscriptions';

/**
 * Create a minimal mock logger for testing.
 */
function createMockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(() => createMockLogger()),
	} as unknown as Logger;
}

/**
 * Create a mock coordinator with spied methods.
 */
function createMockCoordinator(): Coordinator {
	return {
		start: vi.fn(),
		shutdown: vi.fn(),
		spawn: vi.fn(),
		continue: vi.fn(),
		get: vi.fn(),
		getAdapter: vi.fn(),
		list: vi.fn(() => []),
		listCheckpoints: vi.fn(),
		loadCheckpoint: vi.fn(),
		subscribe: vi.fn(),
		status: 'running',
	} as unknown as Coordinator;
}

/**
 * Create a mock model factory.
 */
function createMockModelFactory(): ModelFactory {
	return {
		createAdapter: vi.fn().mockResolvedValue({
			name: 'mock-adapter',
			chat: vi.fn(),
		}),
	} as unknown as ModelFactory;
}

/**
 * Create a mock tool registry.
 */
function createMockToolRegistry(): ToolRegistryInterface {
	return {
		register: vi.fn(),
		get: vi.fn(),
		all: vi.fn(() => []),
		byCategory: vi.fn(() => []),
		extend: vi.fn(),
	} as unknown as ToolRegistryInterface;
}

/**
 * Create a mock conversation manager.
 */
function createMockConversationManager(): ConversationManager {
	return {
		bind: vi.fn(),
		list: vi.fn(() => []),
	} as unknown as ConversationManager;
}

/**
 * Create a mock agent checkpoint.
 */
function createMockCheckpoint(sessionId: string): AgentCheckpoint {
	return {
		timestamp: Date.now(),
		adapterName: 'mock-adapter',
		session: {
			id: sessionId as AgentSessionId,
			createdAt: Date.now(),
			tags: [],
			metadata: {},
			metrics: {
				durationMs: 0,
				turns: 0,
				toolCalls: 0,
			},
		},
		guidance: {
			guidancePath: '/test/guidance',
			memoryWrites: [],
			systemState: {},
		},
		messages: [],
		adapterConfig: {
			provider: 'anthropic',
			model: 'claude-3-sonnet',
		},
		toolExecutions: [],
	};
}

/**
 * Create a mock agent handle.
 */
function createMockAgentHandle(id: string): AgentHandle {
	return {
		id,
		status: 'running',
		config: {
			tags: [],
		},
		createdAt: new Date(),
		start: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		send: vi.fn(),
		terminate: vi.fn(),
		subscribe: vi.fn(),
		snapshot: vi.fn(),
		completion: vi.fn(),
	} as unknown as AgentHandle;
}

/**
 * Create a minimal RPC handler context for testing.
 */
function createMockContext(overrides?: Partial<RpcHandlerContext>): RpcHandlerContext {
	return {
		coordinator: createMockCoordinator(),
		channelRegistry: {} as ChannelRegistry,
		conversationManager: createMockConversationManager(),
		config: {
			socketPath: '/tmp/test.sock',
			storagePath: '/tmp/test-storage',
			logLevel: 'info',
			startTime: Date.now(),
			version: '1.0.0',
		} as DaemonRuntimeConfig,
		shutdownManager: {} as ShutdownManager,
		subscriptionManager: {} as SubscriptionManager,
		connection: { id: 'test-connection' } as TransportConnection,
		logger: createMockLogger(),
		modelFactory: createMockModelFactory(),
		appConfig: undefined,
		toolRegistry: undefined,
		...overrides,
	};
}

/**
 * Helper to get a handler from the handlers map with proper typing.
 * Throws if the handler is not found.
 */
function getHandler(
	handlers: Map<string, (params: unknown, context: RpcHandlerContext) => Promise<unknown>>,
	name: string,
): (params: unknown, context: RpcHandlerContext) => Promise<unknown> {
	const handler = handlers.get(name);
	if (!handler) {
		throw new Error(`Handler not found: ${name}`);
	}
	return handler;
}

describe('RPC Handlers', () => {
	describe('handleAgentList', () => {
		it('should pass orchestrator filters through without querying conversation bindings', async () => {
			const mockCoordinator = createMockCoordinator();
			const mockConversationManager = createMockConversationManager();
			const mockHandle = createMockAgentHandle('running-agent');
			vi.mocked(mockCoordinator.list).mockReturnValue([mockHandle]);

			const context = createMockContext({
				coordinator: mockCoordinator,
				conversationManager: mockConversationManager,
			});
			const handlers = createHandlers(context);
			const agentListHandler = getHandler(handlers, 'agent.list');
			const filter = {
				status: ['running', 'waiting'],
				tags: ['rpc'],
				parentId: 'parent-session',
			};

			const result = await agentListHandler({ filter }, context);

			expect(mockCoordinator.list).toHaveBeenCalledWith(filter);
			expect(mockConversationManager.list).not.toHaveBeenCalled();
			expect(result).toEqual([
				{
					id: mockHandle.id,
					status: mockHandle.status,
					tags: mockHandle.config.tags,
					createdAt: mockHandle.createdAt.toISOString(),
				},
			]);
		});

		it('should intersect coordinator results with non-null agent bindings for a channel', async () => {
			const mockCoordinator = createMockCoordinator();
			const mockConversationManager = createMockConversationManager();
			const matchingHandle = createMockAgentHandle('matching-agent');
			const unboundHandle = createMockAgentHandle('unbound-agent');
			const channelId = createChannelId('test-channel');
			const now = new Date();

			vi.mocked(mockCoordinator.list).mockReturnValue([matchingHandle, unboundHandle]);
			vi.mocked(mockConversationManager.list).mockReturnValue([
				{
					destination: { channelId, ref: 'bound' },
					agentId: matchingHandle.id,
					createdAt: now,
					lastActivityAt: now,
				},
				{
					destination: { channelId, ref: 'unbound' },
					agentId: null,
					createdAt: now,
					lastActivityAt: now,
				},
				{
					destination: { channelId, ref: 'not-listed' },
					agentId: createAgentSessionId('agent-not-returned-by-coordinator'),
					createdAt: now,
					lastActivityAt: now,
				},
			]);

			const context = createMockContext({
				coordinator: mockCoordinator,
				conversationManager: mockConversationManager,
			});
			const handlers = createHandlers(context);
			const agentListHandler = getHandler(handlers, 'agent.list');

			const result = await agentListHandler(
				{
					filter: {
						status: 'running',
						tags: ['rpc'],
						parentId: 'parent-session',
						channelId,
					},
				},
				context,
			);

			expect(mockCoordinator.list).toHaveBeenCalledWith({
				status: 'running',
				tags: ['rpc'],
				parentId: 'parent-session',
			});
			expect(mockConversationManager.list).toHaveBeenCalledWith({ channelId });
			expect(result).toEqual([
				{
					id: matchingHandle.id,
					status: matchingHandle.status,
					tags: matchingHandle.config.tags,
					createdAt: matchingHandle.createdAt.toISOString(),
				},
			]);
		});
	});

	describe('handleAgentSpawn', () => {
		it('should bind the spawned agent before starting it', async () => {
			const callOrder: string[] = [];
			const mockCoordinator = createMockCoordinator();
			const mockConversationManager = createMockConversationManager();
			const mockHandle = createMockAgentHandle('bound-session');
			const destination = { channelId: createChannelId('test-channel'), ref: 'test-conversation' };

			vi.mocked(mockCoordinator.spawn).mockResolvedValue(mockHandle);
			vi.mocked(mockConversationManager.bind).mockImplementation(() => {
				callOrder.push('bind');
			});
			vi.mocked(mockHandle.start).mockImplementation(() => {
				callOrder.push('start');
			});

			const context = createMockContext({
				coordinator: mockCoordinator,
				conversationManager: mockConversationManager,
			});
			const handlers = createHandlers(context);
			const agentSpawnHandler = getHandler(handlers, 'agent.spawn');

			const result = await agentSpawnHandler({ model: 'test/mock-model', bind: destination }, context);

			expect(mockConversationManager.bind).toHaveBeenCalledWith(destination, mockHandle.id);
			expect(callOrder).toEqual(['bind', 'start']);
			expect(result).toEqual({ id: 'bound-session' });
		});

		it('should pass the exact toolRegistry from context to coordinator.spawn()', async () => {
			const mockToolRegistry = createMockToolRegistry();
			const mockCoordinator = createMockCoordinator();
			const mockHandle = createMockAgentHandle('spawned-session');

			vi.mocked(mockCoordinator.spawn).mockResolvedValue(mockHandle);

			const context = createMockContext({
				coordinator: mockCoordinator,
				toolRegistry: mockToolRegistry,
			});
			const handlers = createHandlers(context);
			const agentSpawnHandler = getHandler(handlers, 'agent.spawn');

			const params = {
				model: 'test/mock-model',
				guidancePath: '/test/guidance',
				task: 'test-task',
				input: { message: 'Start the task' },
				tags: ['rpc'],
			};

			const result = await agentSpawnHandler(params, context);

			expect(mockCoordinator.spawn).toHaveBeenCalledWith(expect.any(Object), {
				guidancePath: '/test/guidance',
				task: 'test-task',
				input: { message: 'Start the task' },
				tags: ['rpc'],
				tools: mockToolRegistry,
			});
			const spawnConfig = vi.mocked(mockCoordinator.spawn).mock.calls[0]?.[1];
			expect(spawnConfig?.tools).toBe(mockToolRegistry);
			expect(mockHandle.start).toHaveBeenCalledOnce();
			expect(result).toEqual({ id: 'spawned-session' });
		});

		it('should still spawn with undefined tools when toolRegistry is not in context', async () => {
			const mockCoordinator = createMockCoordinator();
			const mockConversationManager = createMockConversationManager();
			const mockHandle = createMockAgentHandle('spawned-without-tools');

			vi.mocked(mockCoordinator.spawn).mockResolvedValue(mockHandle);

			const context = createMockContext({
				coordinator: mockCoordinator,
				conversationManager: mockConversationManager,
				toolRegistry: undefined,
			});
			const handlers = createHandlers(context);
			const agentSpawnHandler = getHandler(handlers, 'agent.spawn');

			const result = await agentSpawnHandler({ model: 'test/mock-model' }, context);

			expect(mockCoordinator.spawn).toHaveBeenCalledWith(expect.any(Object), {
				guidancePath: undefined,
				task: undefined,
				input: undefined,
				tags: undefined,
				tools: undefined,
			});
			expect(mockConversationManager.bind).not.toHaveBeenCalled();
			expect(mockHandle.start).toHaveBeenCalledOnce();
			expect(result).toEqual({ id: 'spawned-without-tools' });
		});
	});

	describe('handleAgentContinue', () => {
		it('should pass toolRegistry from context to coordinator.continue()', async () => {
			const mockToolRegistry = createMockToolRegistry();
			const mockCoordinator = createMockCoordinator();
			const mockHandle = createMockAgentHandle('session-123');
			const mockCheckpoint = createMockCheckpoint('session-123');

			// Set up mocks
			vi.mocked(mockCoordinator.loadCheckpoint).mockResolvedValue(mockCheckpoint);
			vi.mocked(mockCoordinator.continue).mockResolvedValue(mockHandle);

			const context = createMockContext({
				coordinator: mockCoordinator,
				toolRegistry: mockToolRegistry,
			});

			// Get the handler from createHandlers
			const handlers = createHandlers(context);
			const agentContinueHandler = getHandler(handlers, 'agent.continue');

			// Call the handler
			const params = {
				sessionId: 'session-123',
				input: { text: 'Continue the conversation' },
			};

			await agentContinueHandler(params, context);

			// Verify coordinator.continue was called with toolRegistry
			expect(mockCoordinator.continue).toHaveBeenCalledWith(
				'session-123',
				{ text: 'Continue the conversation' },
				expect.any(Object), // The adapter
				{ tools: mockToolRegistry },
			);
		});

		it('should pass undefined tools when toolRegistry is not in context', async () => {
			const mockCoordinator = createMockCoordinator();
			const mockHandle = createMockAgentHandle('session-456');
			const mockCheckpoint = createMockCheckpoint('session-456');

			// Set up mocks
			vi.mocked(mockCoordinator.loadCheckpoint).mockResolvedValue(mockCheckpoint);
			vi.mocked(mockCoordinator.continue).mockResolvedValue(mockHandle);

			const context = createMockContext({
				coordinator: mockCoordinator,
				toolRegistry: undefined,
			});

			// Get the handler from createHandlers
			const handlers = createHandlers(context);
			const agentContinueHandler = getHandler(handlers, 'agent.continue');

			// Call the handler
			const params = {
				sessionId: 'session-456',
				input: { text: 'Continue without tools' },
			};

			await agentContinueHandler(params, context);

			// Verify coordinator.continue was called with undefined tools
			expect(mockCoordinator.continue).toHaveBeenCalledWith(
				'session-456',
				{ text: 'Continue without tools' },
				expect.any(Object),
				{ tools: undefined },
			);
		});

		it('should throw error when modelFactory is not configured', async () => {
			const context = createMockContext({
				modelFactory: undefined,
			});

			const handlers = createHandlers(context);
			const agentContinueHandler = getHandler(handlers, 'agent.continue');

			const params = {
				sessionId: 'session-789',
				input: { text: 'This should fail' },
			};

			await expect(agentContinueHandler(params, context)).rejects.toThrow(
				'Model factory not configured - cannot continue agents',
			);
		});

		it('should throw error when checkpoint is not found', async () => {
			const mockCoordinator = createMockCoordinator();

			// Set up mock to return null checkpoint
			vi.mocked(mockCoordinator.loadCheckpoint).mockResolvedValue(null);

			const context = createMockContext({
				coordinator: mockCoordinator,
			});

			const handlers = createHandlers(context);
			const agentContinueHandler = getHandler(handlers, 'agent.continue');

			const params = {
				sessionId: 'nonexistent-session',
				input: { text: 'This should fail' },
			};

			await expect(agentContinueHandler(params, context)).rejects.toThrow(
				'Checkpoint not found for session: nonexistent-session',
			);
		});

		it('should use model override when provided in params', async () => {
			const mockToolRegistry = createMockToolRegistry();
			const mockCoordinator = createMockCoordinator();
			const mockModelFactory = createMockModelFactory();
			const mockHandle = createMockAgentHandle('session-override');
			const mockCheckpoint = createMockCheckpoint('session-override');

			// Set up mocks
			vi.mocked(mockCoordinator.loadCheckpoint).mockResolvedValue(mockCheckpoint);
			vi.mocked(mockCoordinator.continue).mockResolvedValue(mockHandle);

			const context = createMockContext({
				coordinator: mockCoordinator,
				modelFactory: mockModelFactory,
				toolRegistry: mockToolRegistry,
			});

			const handlers = createHandlers(context);
			const agentContinueHandler = getHandler(handlers, 'agent.continue');

			const params = {
				sessionId: 'session-override',
				input: { text: 'Continue with different model' },
				model: 'openai/gpt-4',
			};

			await agentContinueHandler(params, context);

			// Verify model factory was called with the override model
			expect(mockModelFactory.createAdapter).toHaveBeenCalledWith('openai/gpt-4', expect.any(Object));

			// Verify coordinator.continue was still called with toolRegistry
			expect(mockCoordinator.continue).toHaveBeenCalledWith(
				'session-override',
				{ text: 'Continue with different model' },
				expect.any(Object),
				{ tools: mockToolRegistry },
			);
		});

		it('should use checkpoint model when no override is provided', async () => {
			const mockCoordinator = createMockCoordinator();
			const mockModelFactory = createMockModelFactory();
			const mockHandle = createMockAgentHandle('session-checkpoint-model');
			const mockCheckpoint = createMockCheckpoint('session-checkpoint-model');
			// Override the checkpoint adapter config
			mockCheckpoint.adapterConfig = {
				provider: 'anthropic',
				model: 'claude-3-opus',
				thinkingLevel: 'medium',
			};

			// Set up mocks
			vi.mocked(mockCoordinator.loadCheckpoint).mockResolvedValue(mockCheckpoint);
			vi.mocked(mockCoordinator.continue).mockResolvedValue(mockHandle);

			const context = createMockContext({
				coordinator: mockCoordinator,
				modelFactory: mockModelFactory,
			});

			const handlers = createHandlers(context);
			const agentContinueHandler = getHandler(handlers, 'agent.continue');

			const params = {
				sessionId: 'session-checkpoint-model',
				input: { text: 'Continue with checkpoint model' },
			};

			await agentContinueHandler(params, context);

			// Verify model factory was called with the checkpoint's model
			expect(mockModelFactory.createAdapter).toHaveBeenCalledWith('anthropic/claude-3-opus', {
				thinkingLevel: 'medium',
			});
		});

		it('should return the agent handle ID', async () => {
			const mockCoordinator = createMockCoordinator();
			const mockHandle = createMockAgentHandle('returned-session-id');
			const mockCheckpoint = createMockCheckpoint('session-return-test');

			// Set up mocks
			vi.mocked(mockCoordinator.loadCheckpoint).mockResolvedValue(mockCheckpoint);
			vi.mocked(mockCoordinator.continue).mockResolvedValue(mockHandle);

			const context = createMockContext({
				coordinator: mockCoordinator,
			});

			const handlers = createHandlers(context);
			const agentContinueHandler = getHandler(handlers, 'agent.continue');

			const params = {
				sessionId: 'session-return-test',
				input: { text: 'Test return value' },
			};

			const result = await agentContinueHandler(params, context);

			expect(result).toEqual({ id: 'returned-session-id' });
		});
	});
});
