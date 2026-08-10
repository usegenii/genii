/**
 * Tests for coordinator.continue() method.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AdapterCreateConfig, AgentAdapter, AgentInstance } from '../../adapters/types';
import type { PendingResolution } from '../../events/types';
import type { GuidanceContext, MemorySystem } from '../../guidance/types';
import { type AgentCheckpoint, CHECKPOINT_VERSION, type SnapshotStore } from '../../snapshot/types';
import { createSuspensionId } from '../../tools/suspension';
import type { ToolRegistryInterface } from '../../tools/types';
import type { AgentSessionId } from '../../types/core';
import { createCoordinator } from '../impl';

/**
 * Create a mock memory system for testing.
 */
function createMockMemorySystem(): MemorySystem {
	return {
		read: vi.fn().mockResolvedValue(null),
		write: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		list: vi.fn().mockResolvedValue([]),
		getState: vi.fn().mockResolvedValue(null),
		setState: vi.fn().mockResolvedValue(undefined),
		updateState: vi.fn().mockResolvedValue(undefined),
		listStateKeys: vi.fn().mockResolvedValue([]),
		onWrite: vi.fn().mockReturnValue(() => {}),
		onDelete: vi.fn().mockReturnValue(() => {}),
	};
}

/**
 * Create a mock guidance context for testing.
 */
function createMockGuidanceContext(root = '/test/guidance'): GuidanceContext {
	return {
		root,
		soul: '# Soul\nTest soul content',
		instructions: '# Instructions\nTest instructions',
		loadTask: vi.fn().mockResolvedValue(null),
		listTasks: vi.fn().mockResolvedValue([]),
		loadSkill: vi.fn().mockResolvedValue(null),
		listSkills: vi.fn().mockResolvedValue([]),
		memory: createMockMemorySystem(),
	};
}

/**
 * Create a mock agent instance for testing.
 */
function createMockAgentInstance(id: string): AgentInstance {
	return {
		id,
		run: vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield {
					type: 'done',
					result: { status: 'completed', output: 'test', metrics: { durationMs: 0, turns: 0, toolCalls: 0 } },
				};
			},
		}),
		send: vi.fn(),
		pause: vi.fn().mockResolvedValue(undefined),
		resume: vi.fn().mockResolvedValue(undefined),
		abort: vi.fn(),
		checkpoint: vi.fn().mockResolvedValue({
			timestamp: Date.now(),
			adapterName: 'mock',
			session: {
				id,
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
			adapterConfig: {},
			toolExecutions: [],
		}),
		status: vi.fn().mockReturnValue('idle'),
		getPendingRequests: vi.fn().mockReturnValue([]),
		resolve: vi.fn(),
	};
}

/**
 * Create a mock checkpoint for testing.
 */
function createMockCheckpoint(sessionId: string): AgentCheckpoint {
	return {
		timestamp: Date.now(),
		adapterName: 'mock',
		session: {
			id: sessionId as AgentSessionId,
			createdAt: Date.now(),
			tags: ['test'],
			metadata: { key: 'value' },
			task: 'test-task',
			metrics: {
				durationMs: 1000,
				turns: 5,
				toolCalls: 3,
			},
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
}

function createSuspendedCheckpoint(sessionId: AgentSessionId): AgentCheckpoint {
	const checkpoint = createMockCheckpoint(sessionId);
	const stepId = '__suspension:event:build:0';
	const suspensionId = createSuspensionId('tool-call-1', stepId);
	checkpoint.toolExecutions = [
		{
			toolName: 'wait-for-build',
			toolCallId: 'tool-call-1',
			input: { sha: 'abc' },
			completedSteps: [{ stepId: 'create-pr', result: 123, completedAt: 100 }],
			suspendedStep: {
				suspensionId,
				stepId,
				request: { type: 'event', eventName: 'build.completed', options: { timeout: 5000 } },
				suspendedAt: 1000,
				deadline: 6000,
				status: 'waiting',
			},
		},
	];
	return checkpoint;
}

/**
 * Create a mock tool registry for testing.
 */
function createMockToolRegistry(): ToolRegistryInterface {
	const registry: ToolRegistryInterface = {
		register: vi.fn(),
		get: vi.fn().mockReturnValue(undefined),
		all: vi.fn().mockReturnValue([]),
		byCategory: vi.fn().mockReturnValue([]),
		extend: vi.fn().mockImplementation(() => registry),
	};
	return registry;
}

/**
 * Create a mock adapter for testing.
 */
function createMockAdapter(
	onRestore?: (checkpoint: AgentCheckpoint, config: AdapterCreateConfig) => void,
): AgentAdapter {
	return {
		name: 'mock',
		modelProvider: 'mock-provider',
		modelName: 'mock-model',
		create: vi.fn().mockImplementation(async () => {
			return createMockAgentInstance(`instance-${Date.now()}`);
		}),
		restore: vi.fn().mockImplementation(async (checkpoint: AgentCheckpoint, config: AdapterCreateConfig) => {
			onRestore?.(checkpoint, config);
			return createMockAgentInstance(checkpoint.session.id);
		}),
	};
}

/**
 * Create a mock snapshot store for testing.
 */
function createMockSnapshotStore(checkpoints: Map<string, AgentCheckpoint>): SnapshotStore {
	return {
		save: vi.fn().mockResolvedValue(undefined),
		load: vi.fn().mockImplementation(async (sessionId: AgentSessionId) => {
			return checkpoints.get(sessionId) ?? null;
		}),
		delete: vi.fn().mockResolvedValue(true),
		list: vi.fn().mockResolvedValue([...checkpoints.keys()]),
		exists: vi.fn().mockImplementation(async (sessionId: AgentSessionId) => {
			return checkpoints.has(sessionId);
		}),
	};
}

// Mock the guidance context creation
vi.mock('../../guidance/context', () => ({
	createGuidanceContext: vi.fn().mockImplementation(async ({ root }: { root: string }) => {
		return createMockGuidanceContext(root);
	}),
}));

describe('Coordinator.continue()', () => {
	describe('tools passing', () => {
		it('should pass tools to adapter.restore() when provided in ContinueConfig', async () => {
			// Arrange
			const sessionId = 'test-session-1' as AgentSessionId;
			const checkpoint = createMockCheckpoint(sessionId);
			const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
			const snapshotStore = createMockSnapshotStore(checkpoints);

			let capturedConfig: AdapterCreateConfig | undefined;
			const adapter = createMockAdapter((_checkpoint, config) => {
				capturedConfig = config;
			});

			const coordinator = createCoordinator({
				snapshotStore,
				defaultGuidancePath: '/test/guidance',
			});

			await coordinator.start();

			const mockToolRegistry = createMockToolRegistry();

			// Act
			await coordinator.continue(sessionId, { message: 'Continue with this message' }, adapter, {
				tools: mockToolRegistry,
			});

			// Assert
			expect(adapter.restore).toHaveBeenCalledTimes(1);
			expect(capturedConfig).toBeDefined();
			expect(capturedConfig?.tools).toBe(mockToolRegistry);
		});

		it('should pass undefined tools to adapter.restore() when ContinueConfig has no tools', async () => {
			// Arrange
			const sessionId = 'test-session-2' as AgentSessionId;
			const checkpoint = createMockCheckpoint(sessionId);
			const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
			const snapshotStore = createMockSnapshotStore(checkpoints);

			let capturedConfig: AdapterCreateConfig | undefined;
			const adapter = createMockAdapter((_checkpoint, config) => {
				capturedConfig = config;
			});

			const coordinator = createCoordinator({
				snapshotStore,
				defaultGuidancePath: '/test/guidance',
			});

			await coordinator.start();

			// Act
			await coordinator.continue(
				sessionId,
				{ message: 'Continue with this message' },
				adapter,
				{}, // Empty ContinueConfig, no tools
			);

			// Assert
			expect(adapter.restore).toHaveBeenCalledTimes(1);
			expect(capturedConfig).toBeDefined();
			expect(capturedConfig?.tools).toBeUndefined();
		});

		it('should pass undefined tools to adapter.restore() when ContinueConfig is undefined (backward compatibility)', async () => {
			// Arrange
			const sessionId = 'test-session-3' as AgentSessionId;
			const checkpoint = createMockCheckpoint(sessionId);
			const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
			const snapshotStore = createMockSnapshotStore(checkpoints);

			let capturedConfig: AdapterCreateConfig | undefined;
			const adapter = createMockAdapter((_checkpoint, config) => {
				capturedConfig = config;
			});

			const coordinator = createCoordinator({
				snapshotStore,
				defaultGuidancePath: '/test/guidance',
			});

			await coordinator.start();

			// Act
			await coordinator.continue(
				sessionId,
				{ message: 'Continue with this message' },
				adapter,
				// No ContinueConfig passed (undefined)
			);

			// Assert
			expect(adapter.restore).toHaveBeenCalledTimes(1);
			expect(capturedConfig).toBeDefined();
			expect(capturedConfig?.tools).toBeUndefined();
		});
	});

	describe('error handling', () => {
		it('should throw error when checkpoint is not found', async () => {
			// Arrange
			const sessionId = 'nonexistent-session' as AgentSessionId;
			const checkpoints = new Map<string, AgentCheckpoint>();
			const snapshotStore = createMockSnapshotStore(checkpoints);
			const adapter = createMockAdapter();

			const coordinator = createCoordinator({
				snapshotStore,
				defaultGuidancePath: '/test/guidance',
			});

			await coordinator.start();

			// Act & Assert
			await expect(coordinator.continue(sessionId, { message: 'test' }, adapter)).rejects.toThrow(
				`Checkpoint not found for session: ${sessionId}`,
			);
		});

		it('should throw error when coordinator is not running', async () => {
			// Arrange
			const sessionId = 'test-session' as AgentSessionId;
			const adapter = createMockAdapter();

			const coordinator = createCoordinator({
				defaultGuidancePath: '/test/guidance',
			});

			// Not calling coordinator.start()

			// Act & Assert
			await expect(coordinator.continue(sessionId, { message: 'test' }, adapter)).rejects.toThrow(
				'Cannot continue agent when coordinator is stopped',
			);
		});
	});

	describe('checkpoint data passing', () => {
		it('should pass checkpoint data correctly to adapter.restore()', async () => {
			// Arrange
			const sessionId = 'test-session-4' as AgentSessionId;
			const checkpoint = createMockCheckpoint(sessionId);
			checkpoint.session.task = 'special-task';
			checkpoint.session.parentId = 'parent-session' as AgentSessionId;
			checkpoint.session.tags = ['tag1', 'tag2'];
			checkpoint.session.metadata = { custom: 'data' };

			const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
			const snapshotStore = createMockSnapshotStore(checkpoints);

			let capturedConfig: AdapterCreateConfig | undefined;
			const adapter = createMockAdapter((_checkpoint, config) => {
				capturedConfig = config;
			});

			const coordinator = createCoordinator({
				snapshotStore,
				defaultGuidancePath: '/test/guidance',
			});

			await coordinator.start();

			const input = { message: 'New message', context: { foo: 'bar' } };

			// Act
			await coordinator.continue(sessionId, input, adapter);

			// Assert
			expect(capturedConfig).toBeDefined();
			expect(capturedConfig?.task).toBe('special-task');
			expect(capturedConfig?.parentId).toBe('parent-session');
			expect(capturedConfig?.tags).toEqual(['tag1', 'tag2']);
			expect(capturedConfig?.metadata).toEqual({ custom: 'data' });
			expect(capturedConfig?.input).toEqual(input);
		});
	});
});

describe('Coordinator durable suspensions', () => {
	it('enriches and awaits adapter lifecycle checkpoints', async () => {
		const snapshotStore = createMockSnapshotStore(new Map());
		const instance = createMockAgentInstance('barrier-session');
		let capturedConfig: AdapterCreateConfig | undefined;
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockImplementation(async (config: AdapterCreateConfig) => {
			capturedConfig = config;
			return instance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
		if (!capturedConfig?.onCheckpoint) throw new Error('Expected checkpoint lifecycle callback');

		await capturedConfig.onCheckpoint(await instance.checkpoint(), 'suspended');

		expect(snapshotStore.save).toHaveBeenCalledWith(
			expect.objectContaining({
				version: CHECKPOINT_VERSION,
				adapterConfig: expect.objectContaining({
					provider: adapter.modelProvider,
					model: adapter.modelName,
				}),
			}),
		);
	});

	it('surfaces lifecycle checkpoint failures to the adapter', async () => {
		const snapshotStore = createMockSnapshotStore(new Map());
		vi.mocked(snapshotStore.save).mockRejectedValue(new Error('disk unavailable'));
		const instance = createMockAgentInstance('barrier-failure-session');
		let capturedConfig: AdapterCreateConfig | undefined;
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockImplementation(async (config: AdapterCreateConfig) => {
			capturedConfig = config;
			return instance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
		if (!capturedConfig?.onCheckpoint) throw new Error('Expected checkpoint lifecycle callback');

		await expect(capturedConfig.onCheckpoint(await instance.checkpoint(), 'suspended')).rejects.toThrow(
			'disk unavailable',
		);
	});

	it('inspects a dormant request without restoring an adapter', async () => {
		const sessionId = 'dormant-session' as AgentSessionId;
		const checkpoint = createSuspendedCheckpoint(sessionId);
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		const requests = await coordinator.getPendingRequests(sessionId);

		expect(requests).toEqual([
			expect.objectContaining({
				suspensionId: checkpoint.toolExecutions[0]?.suspendedStep?.suspensionId,
				toolCallId: 'tool-call-1',
				stepId: '__suspension:event:build:0',
				type: 'event',
				status: 'waiting',
				deadline: 6000,
			}),
		]);
	});

	it('rejects ordinary continuation while a checkpoint is suspended', async () => {
		const sessionId = 'waiting-session' as AgentSessionId;
		const checkpoint = createSuspendedCheckpoint(sessionId);
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		const adapter = createMockAdapter();
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		await expect(coordinator.continue(sessionId, { message: 'ordinary input' }, adapter)).rejects.toThrow(
			'waiting for a suspension resolution',
		);
		expect(adapter.restore).not.toHaveBeenCalled();
	});

	it('restores and accepts a dormant resolution without adding user input', async () => {
		const sessionId = 'resolved-session' as AgentSessionId;
		const checkpoint = createSuspendedCheckpoint(sessionId);
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		const tools = createMockToolRegistry();
		const instance = createMockAgentInstance(sessionId);
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockImplementation(async (_checkpoint, config: AdapterCreateConfig) => {
			expect(config.input).toBeUndefined();
			expect(config.contextInjection).toBeUndefined();
			expect(config.tools).toBe(tools);
			return instance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const resolution: PendingResolution = {
			suspensionId: checkpoint.toolExecutions[0]?.suspendedStep
				?.suspensionId as PendingResolution['suspensionId'],
			type: 'event',
			payload: { conclusion: 'success' },
		};

		const handle = await coordinator.resolveSuspensions(sessionId, [resolution], adapter, { tools });

		expect(handle.id).toBe(sessionId);
		expect(instance.resolve).toHaveBeenCalledWith([resolution]);
		expect(adapter.restore).toHaveBeenCalledTimes(1);
	});

	it('flushes and detaches waiting sessions during shutdown without terminating them', async () => {
		const sessionId = 'shutdown-session' as AgentSessionId;
		const snapshotStore = createMockSnapshotStore(new Map());
		const instance = createMockAgentInstance(sessionId);
		instance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield { type: 'status' as const, status: 'waiting' as const, timestamp: Date.now() };
			},
		});
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockResolvedValue(instance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
		await handle.start();

		await coordinator.shutdown({ graceful: true, timeoutMs: 1 });

		expect(snapshotStore.save).toHaveBeenCalled();
		expect(instance.abort).not.toHaveBeenCalled();
	});
});
