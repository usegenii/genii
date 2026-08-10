/**
 * Tests for RPC handlers.
 */

import type { ChannelRegistry } from '@genii/comms/registry/types';
import type { ModelFactory } from '@genii/models/factory';
import type { AgentAdapter } from '@genii/orchestrator/adapters/types';
import type { Coordinator } from '@genii/orchestrator/coordinator/types';
import type { PendingRequestInfo, PendingResolution } from '@genii/orchestrator/events/types';
import type { AgentHandle } from '@genii/orchestrator/handle/types';
import type { AgentCheckpoint } from '@genii/orchestrator/snapshot/types';
import type { SuspensionId, ToolRegistryInterface } from '@genii/orchestrator/tools/types';
import type { AgentSessionId } from '@genii/orchestrator/types/core';
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
		getPendingRequests: vi.fn(),
		restoreSuspended: vi.fn(),
		resolveSuspensions: vi.fn(),
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
	describe('handleAgentSpawn', () => {
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
			const mockHandle = createMockAgentHandle('spawned-without-tools');

			vi.mocked(mockCoordinator.spawn).mockResolvedValue(mockHandle);

			const context = createMockContext({
				coordinator: mockCoordinator,
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
			expect(mockHandle.start).toHaveBeenCalledOnce();
			expect(result).toEqual({ id: 'spawned-without-tools' });
		});
	});

	describe('conversation persistence', () => {
		it('waits for an unbind to be persisted before acknowledging it', async () => {
			let releasePersistence: (() => void) | undefined;
			const unbind = vi.fn(
				() =>
					new Promise<void>((resolve) => {
						releasePersistence = resolve;
					}),
			);
			const conversationManager = { unbind } as unknown as ConversationManager;
			const context = createMockContext({ conversationManager });
			const handler = getHandler(createHandlers(context), 'conversation.unbind');
			const destination = { channelId: 'telegram', ref: 'chat-1' };

			let acknowledged = false;
			const result = handler({ destination }, context).then((value) => {
				acknowledged = true;
				return value;
			});
			await Promise.resolve();

			expect(unbind).toHaveBeenCalledWith(destination);
			expect(acknowledged).toBe(false);

			releasePersistence?.();
			await expect(result).resolves.toEqual({ ok: true });
		});
	});

	describe('durable suspension control plane', () => {
		it('inspects pending requests without creating a model adapter', async () => {
			const coordinator = createMockCoordinator();
			const modelFactory = createMockModelFactory();
			const pendingRequest: PendingRequestInfo = {
				suspensionId: 'suspension-1' as SuspensionId,
				toolCallId: 'tool-call-1',
				toolName: 'wait_for_build',
				stepId: 'wait-for-build',
				type: 'approval',
				request: {
					type: 'approval',
					action: 'deploy',
					details: { buildNumber: 42n },
				},
				suspendedAt: 123,
				deadline: 456,
				status: 'resolved',
			};
			vi.mocked(coordinator.getPendingRequests).mockResolvedValue([pendingRequest]);

			const context = createMockContext({ coordinator, modelFactory });
			const handler = getHandler(createHandlers(context), 'agent.pendingRequests');

			await expect(handler({ sessionId: 'session-1' }, context)).resolves.toEqual([
				{
					suspensionId: 'suspension-1',
					toolCallId: 'tool-call-1',
					toolName: 'wait_for_build',
					stepId: 'wait-for-build',
					type: 'approval',
					request: {
						type: 'approval',
						action: 'deploy',
						details: { buildNumber: '42' },
					},
					suspendedAt: 123,
					deadline: 456,
					status: 'resolved',
				},
			]);
			expect(coordinator.getPendingRequests).toHaveBeenCalledWith('session-1');
			expect(modelFactory.createAdapter).not.toHaveBeenCalled();
		});

		it('restores the checkpoint model and resolves without spawning a replacement agent', async () => {
			const coordinator = createMockCoordinator();
			const modelFactory = createMockModelFactory();
			const toolRegistry = createMockToolRegistry();
			const checkpoint = createMockCheckpoint('session-2');
			checkpoint.adapterConfig = {
				provider: 'anthropic',
				model: 'claude-3-opus',
				thinkingLevel: 'high',
			};
			const handle = createMockAgentHandle('session-2');
			const resolutions: PendingResolution[] = [
				{
					suspensionId: 'suspension-2' as SuspensionId,
					type: 'approval',
					approved: false,
					reason: 'Not safe yet',
				},
			];
			vi.mocked(coordinator.loadCheckpoint).mockResolvedValue(checkpoint);
			vi.mocked(coordinator.resolveSuspensions).mockResolvedValue(handle);

			const context = createMockContext({ coordinator, modelFactory, toolRegistry });
			const handler = getHandler(createHandlers(context), 'agent.resolveSuspensions');

			await expect(handler({ sessionId: 'session-2', resolutions }, context)).resolves.toEqual({
				id: 'session-2',
			});
			expect(modelFactory.createAdapter).toHaveBeenCalledWith('anthropic/claude-3-opus', {
				thinkingLevel: 'high',
			});
			expect(coordinator.resolveSuspensions).toHaveBeenCalledWith('session-2', resolutions, expect.any(Object), {
				tools: toolRegistry,
			});
			expect(coordinator.spawn).not.toHaveBeenCalled();
			expect(coordinator.continue).not.toHaveBeenCalled();
		});

		it('resolves a warm suspension without loading a checkpoint or creating another adapter', async () => {
			const coordinator = createMockCoordinator();
			const adapter = {
				name: 'warm',
				modelProvider: 'anthropic',
				modelName: 'claude-warm',
			} as AgentAdapter;
			const handle = createMockAgentHandle('warm-session');
			const resolutions: PendingResolution[] = [
				{ suspensionId: 'warm-suspension' as SuspensionId, type: 'sleep' },
			];
			vi.mocked(coordinator.getAdapter).mockReturnValue(adapter);
			vi.mocked(coordinator.resolveSuspensions).mockResolvedValue(handle);
			const context = createMockContext({ coordinator, modelFactory: undefined });
			const handler = getHandler(createHandlers(context), 'agent.resolveSuspensions');

			await expect(handler({ sessionId: 'warm-session', resolutions }, context)).resolves.toEqual({
				id: 'warm-session',
			});
			expect(coordinator.loadCheckpoint).not.toHaveBeenCalled();
			expect(coordinator.resolveSuspensions).toHaveBeenCalledWith('warm-session', resolutions, adapter, {
				tools: undefined,
			});
		});

		it('rejects a malformed resolution before loading an adapter', async () => {
			const coordinator = createMockCoordinator();
			const modelFactory = createMockModelFactory();
			const context = createMockContext({ coordinator, modelFactory });
			const handler = getHandler(createHandlers(context), 'agent.resolveSuspensions');

			await expect(
				handler(
					{
						sessionId: 'session-1',
						resolutions: [{ suspensionId: 'suspension-1', type: 'approval', approved: 'yes' }],
					},
					context,
				),
			).rejects.toThrow('"approved" must be a boolean');
			expect(coordinator.getAdapter).not.toHaveBeenCalled();
			expect(coordinator.loadCheckpoint).not.toHaveBeenCalled();
			expect(modelFactory.createAdapter).not.toHaveBeenCalled();
			expect(coordinator.resolveSuspensions).not.toHaveBeenCalled();
		});

		it('rejects a non-array resolution collection', async () => {
			const coordinator = createMockCoordinator();
			const context = createMockContext({ coordinator });
			const handler = getHandler(createHandlers(context), 'agent.resolveSuspensions');

			await expect(handler({ sessionId: 'session-1', resolutions: { type: 'sleep' } }, context)).rejects.toThrow(
				'expected an array',
			);
			expect(coordinator.getAdapter).not.toHaveBeenCalled();
			expect(coordinator.resolveSuspensions).not.toHaveBeenCalled();
		});

		it('fails resolution when the original checkpoint is missing', async () => {
			const coordinator = createMockCoordinator();
			const modelFactory = createMockModelFactory();
			vi.mocked(coordinator.loadCheckpoint).mockResolvedValue(null);

			const context = createMockContext({ coordinator, modelFactory });
			const handler = getHandler(createHandlers(context), 'agent.resolveSuspensions');
			const resolutions: PendingResolution[] = [{ suspensionId: 'missing' as SuspensionId, type: 'sleep' }];

			await expect(handler({ sessionId: 'missing-session', resolutions }, context)).rejects.toThrow(
				'Checkpoint not found for session: missing-session',
			);
			expect(modelFactory.createAdapter).not.toHaveBeenCalled();
			expect(coordinator.resolveSuspensions).not.toHaveBeenCalled();
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
