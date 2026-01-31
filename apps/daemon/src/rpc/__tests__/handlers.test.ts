/**
 * Tests for RPC handlers.
 */

import type { ChannelRegistry } from '@geniigotchi/comms/registry/types';
import type { ModelFactory } from '@geniigotchi/models/factory';
import type { Coordinator } from '@geniigotchi/orchestrator/coordinator/types';
import type { AgentHandle } from '@geniigotchi/orchestrator/handle/types';
import type { AgentCheckpoint } from '@geniigotchi/orchestrator/snapshot/types';
import type { ToolRegistryInterface } from '@geniigotchi/orchestrator/tools/types';
import type { AgentSessionId } from '@geniigotchi/orchestrator/types/core';
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
		conversationManager: {} as ConversationManager,
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
