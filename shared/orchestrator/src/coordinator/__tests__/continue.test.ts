/**
 * Tests for coordinator.continue() method.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AdapterCreateConfig, AgentAdapter, AgentInstance } from '../../adapters/types';
import type { PendingRequestInfo, PendingResolution } from '../../events/types';
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

function createContinuationCheckpoint(sessionId: AgentSessionId): AgentCheckpoint {
	const checkpoint = createSuspendedCheckpoint(sessionId);
	const execution = checkpoint.toolExecutions[0];
	if (!execution?.suspendedStep) throw new Error('Expected a suspended execution');
	const resolution: PendingResolution = {
		suspensionId: execution.suspendedStep.suspensionId,
		type: 'event',
		payload: { completed: true },
	};
	execution.suspendedStep.status = 'resolved';
	execution.suspendedStep.resolution = resolution;
	execution.suspendedStep.resumeData = {
		stepId: execution.suspendedStep.stepId,
		outcome: { type: 'value', value: resolution.payload },
	};
	execution.result = {
		content: [{ type: 'text', text: 'completed' }],
		isError: false,
		completedAt: 7000,
	};
	checkpoint.phase = 'continuation_pending';
	return checkpoint;
}

function createBatchPendingCheckpoint(sessionId: AgentSessionId): AgentCheckpoint {
	const checkpoint = createContinuationCheckpoint(sessionId);
	checkpoint.phase = 'batch_pending';
	checkpoint.toolExecutions.push({
		toolName: 'finish-build',
		toolCallId: 'tool-call-2',
		input: { sha: 'def' },
		sourceOrder: 1,
		completedSteps: [],
	});
	return checkpoint;
}

function createAcceptedResolutionBatchCheckpoint(sessionId: AgentSessionId): AgentCheckpoint {
	const checkpoint = createBatchPendingCheckpoint(sessionId);
	const acceptedExecution = checkpoint.toolExecutions[0];
	if (
		!acceptedExecution?.suspendedStep?.resolution ||
		acceptedExecution.suspendedStep.status !== 'resolved' ||
		!acceptedExecution.suspendedStep.resumeData
	) {
		throw new Error('Expected a durable accepted suspension resolution');
	}
	delete acceptedExecution.result;
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

	describe('session fencing', () => {
		it('rejects an overlapping continuation before a second checkpoint load or restore', async () => {
			const sessionId = 'overlapping-continuation-session' as AgentSessionId;
			const checkpoint = createMockCheckpoint(sessionId);
			const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
			let markLoadStarted: (() => void) | undefined;
			let releaseLoad: (() => void) | undefined;
			const loadStarted = new Promise<void>((resolve) => {
				markLoadStarted = resolve;
			});
			const loadGate = new Promise<void>((resolve) => {
				releaseLoad = resolve;
			});
			vi.mocked(snapshotStore.load).mockImplementation(async () => {
				markLoadStarted?.();
				await loadGate;
				return checkpoint;
			});
			const adapter = createMockAdapter();
			const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
			await coordinator.start();

			const first = coordinator.continue(sessionId, { message: 'first' }, adapter);
			await loadStarted;

			await expect(coordinator.continue(sessionId, { message: 'second' }, adapter)).rejects.toThrow(
				`Session ${sessionId} already has a continuation in progress`,
			);
			expect(snapshotStore.load).toHaveBeenCalledTimes(1);
			expect(adapter.restore).not.toHaveBeenCalled();

			releaseLoad?.();
			await expect(first).resolves.toEqual(expect.objectContaining({ id: sessionId }));
			expect(adapter.restore).toHaveBeenCalledTimes(1);
		});

		it('rejects continuation while the session has a running handle', async () => {
			const sessionId = 'active-continuation-session' as AgentSessionId;
			const snapshotStore = createMockSnapshotStore(new Map([[sessionId, createMockCheckpoint(sessionId)]]));
			let markRunStarted: (() => void) | undefined;
			let releaseRun: (() => void) | undefined;
			const runStarted = new Promise<void>((resolve) => {
				markRunStarted = resolve;
			});
			const runGate = new Promise<void>((resolve) => {
				releaseRun = resolve;
			});
			const instance = createMockAgentInstance(sessionId);
			instance.run = vi.fn().mockReturnValue({
				[Symbol.asyncIterator]: async function* () {
					yield { type: 'status' as const, status: 'running' as const, timestamp: Date.now() };
					markRunStarted?.();
					await runGate;
				},
			});
			const adapter = createMockAdapter();
			adapter.create = vi.fn().mockResolvedValue(instance);
			const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
			await coordinator.start();
			const activeHandle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
			const activeRun = activeHandle.start();
			await runStarted;

			await expect(coordinator.continue(sessionId, { message: 'overlap' }, adapter)).rejects.toThrow(
				`Session ${sessionId} is already active with status running`,
			);
			expect(snapshotStore.load).not.toHaveBeenCalled();
			expect(adapter.restore).not.toHaveBeenCalled();

			releaseRun?.();
			await activeRun;
		});

		it('aborts a continued instance created after shutdown changed the coordinator lifecycle', async () => {
			const sessionId = 'late-continuation-session' as AgentSessionId;
			const checkpoint = createMockCheckpoint(sessionId);
			const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
			let markRestoreStarted: (() => void) | undefined;
			let releaseRestore: (() => void) | undefined;
			const restoreStarted = new Promise<void>((resolve) => {
				markRestoreStarted = resolve;
			});
			const restoreGate = new Promise<void>((resolve) => {
				releaseRestore = resolve;
			});
			const lateInstance = createMockAgentInstance(sessionId);
			const adapter = createMockAdapter();
			adapter.restore = vi.fn().mockImplementation(async () => {
				markRestoreStarted?.();
				await restoreGate;
				return lateInstance;
			});
			const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
			await coordinator.start();

			const continued = coordinator.continue(sessionId, { message: 'late input' }, adapter);
			await restoreStarted;
			await coordinator.shutdown({ graceful: false, timeoutMs: 1 });
			releaseRestore?.();

			await expect(continued).rejects.toThrow('coordinator lifecycle changed');
			expect(lateInstance.abort).toHaveBeenCalledTimes(1);
			expect(lateInstance.run).not.toHaveBeenCalled();
			expect(coordinator.get(sessionId)).toBeUndefined();
		});

		it('aborts a cold suspended restore that finishes after shutdown without resolving or starting it', async () => {
			const sessionId = 'late-suspension-restore-session' as AgentSessionId;
			const checkpoint = createSuspendedCheckpoint(sessionId);
			const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
			let markRestoreStarted: (() => void) | undefined;
			let releaseRestore: (() => void) | undefined;
			const restoreStarted = new Promise<void>((resolve) => {
				markRestoreStarted = resolve;
			});
			const restoreGate = new Promise<void>((resolve) => {
				releaseRestore = resolve;
			});
			const lateInstance = createMockAgentInstance(sessionId);
			const adapter = createMockAdapter();
			adapter.restore = vi.fn().mockImplementation(async () => {
				markRestoreStarted?.();
				await restoreGate;
				return lateInstance;
			});
			const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
			await coordinator.start();
			const suspendedStep = checkpoint.toolExecutions[0]?.suspendedStep;
			if (!suspendedStep) throw new Error('Expected a suspended checkpoint');

			const resolving = coordinator.resolveSuspensions(
				sessionId,
				[{ suspensionId: suspendedStep.suspensionId, type: 'event', payload: 'late' }],
				adapter,
			);
			await restoreStarted;
			await coordinator.shutdown({ graceful: false, timeoutMs: 1 });
			releaseRestore?.();

			await expect(resolving).rejects.toThrow('coordinator lifecycle changed');
			expect(lateInstance.abort).toHaveBeenCalledTimes(1);
			expect(lateInstance.resolve).not.toHaveBeenCalled();
			expect(lateInstance.run).not.toHaveBeenCalled();
			expect(coordinator.get(sessionId)).toBeUndefined();
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

	it('waits for a completed handle terminal checkpoint before loading the next turn', async () => {
		const sessionId = 'terminal-checkpoint-wait-session' as AgentSessionId;
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, createContinuationCheckpoint(sessionId)]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		let releaseTerminalSave: (() => void) | undefined;
		let markTerminalSaveStarted: (() => void) | undefined;
		const terminalSaveGate = new Promise<void>((resolve) => {
			releaseTerminalSave = resolve;
		});
		const terminalSaveStarted = new Promise<void>((resolve) => {
			markTerminalSaveStarted = resolve;
		});
		vi.mocked(snapshotStore.save).mockImplementation(async (checkpoint) => {
			markTerminalSaveStarted?.();
			await terminalSaveGate;
			checkpoints.set(checkpoint.session.id, structuredClone(checkpoint));
		});

		const completedInstance = createMockAgentInstance(sessionId);
		vi.mocked(completedInstance.checkpoint).mockResolvedValue(createMockCheckpoint(sessionId));
		const restoredInstance = createMockAgentInstance(sessionId);
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockResolvedValue(completedInstance);
		adapter.restore = vi.fn().mockResolvedValue(restoredInstance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const completedHandle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
		await completedHandle.start();
		await terminalSaveStarted;

		const continued = coordinator.continue(sessionId, { message: 'next turn' }, adapter);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(snapshotStore.load).not.toHaveBeenCalled();
		expect(adapter.restore).not.toHaveBeenCalled();

		releaseTerminalSave?.();
		await expect(continued).resolves.toEqual(expect.objectContaining({ id: sessionId }));
		expect(snapshotStore.load).toHaveBeenCalledTimes(1);
		expect(adapter.restore).toHaveBeenCalledTimes(1);
	});

	it('waits for done after a handle has only announced completed status', async () => {
		const sessionId = 'completed-status-gap-session' as AgentSessionId;
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, createMockCheckpoint(sessionId)]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		let markCompletedStatus: (() => void) | undefined;
		let releaseDone: (() => void) | undefined;
		const completedStatus = new Promise<void>((resolve) => {
			markCompletedStatus = resolve;
		});
		const doneGate = new Promise<void>((resolve) => {
			releaseDone = resolve;
		});
		const completedInstance = createMockAgentInstance(sessionId);
		completedInstance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield { type: 'status' as const, status: 'completed' as const, timestamp: Date.now() };
				markCompletedStatus?.();
				await doneGate;
				yield {
					type: 'done' as const,
					result: {
						status: 'completed' as const,
						output: 'complete',
						metrics: { durationMs: 1, turns: 1, toolCalls: 0 },
					},
					timestamp: Date.now(),
				};
			},
		});
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockResolvedValue(completedInstance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const completedHandle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
		const completedRun = completedHandle.start();
		await completedStatus;

		const continued = coordinator.continue(sessionId, { message: 'next turn' }, adapter);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(snapshotStore.load).not.toHaveBeenCalled();
		expect(adapter.restore).not.toHaveBeenCalled();

		releaseDone?.();
		await completedRun;
		await expect(continued).resolves.toEqual(expect.objectContaining({ id: sessionId }));
		expect(snapshotStore.load).toHaveBeenCalledTimes(1);
		expect(adapter.restore).toHaveBeenCalledTimes(1);
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

	it('marks a completed durable batch as continuation pending', async () => {
		const snapshotStore = createMockSnapshotStore(new Map());
		const instance = createMockAgentInstance('continuation-barrier-session');
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
		const completedBatch = createContinuationCheckpoint(instance.id as AgentSessionId);
		delete completedBatch.phase;

		await capturedConfig.onCheckpoint(completedBatch, 'tool_completed');

		expect(snapshotStore.save).toHaveBeenLastCalledWith(
			expect.objectContaining({
				phase: 'continuation_pending',
				toolExecutions: [expect.objectContaining({ result: expect.any(Object) })],
			}),
		);
	});

	it('marks a durable batch with an unfinished ordinary sibling as batch pending', async () => {
		const snapshotStore = createMockSnapshotStore(new Map());
		const instance = createMockAgentInstance('partial-batch-barrier-session');
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
		const partialBatch = createBatchPendingCheckpoint(instance.id as AgentSessionId);
		delete partialBatch.phase;

		await capturedConfig.onCheckpoint(partialBatch, 'tool_completed');

		expect(snapshotStore.save).toHaveBeenLastCalledWith(
			expect.objectContaining({
				phase: 'batch_pending',
				toolExecutions: [expect.objectContaining({ result: expect.any(Object) }), expect.any(Object)],
			}),
		);
	});

	it('marks a terminal all-results durable batch as continuation pending', async () => {
		const snapshotStore = createMockSnapshotStore(new Map());
		const instance = createMockAgentInstance('terminal-continuation-session');
		const terminalBatch = createContinuationCheckpoint(instance.id as AgentSessionId);
		delete terminalBatch.phase;
		vi.mocked(instance.checkpoint).mockResolvedValue(terminalBatch);
		instance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield {
					type: 'done' as const,
					result: {
						status: 'failed' as const,
						error: 'lifecycle barrier failed',
						metrics: { durationMs: 0, turns: 1, toolCalls: 1 },
					},
					timestamp: Date.now(),
				};
			},
		});
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockResolvedValue(instance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });

		await handle.start();
		await vi.waitFor(() => expect(snapshotStore.save).toHaveBeenCalledTimes(1));

		expect(snapshotStore.save).toHaveBeenLastCalledWith(
			expect.objectContaining({
				phase: 'continuation_pending',
				toolExecutions: [expect.objectContaining({ result: expect.any(Object) })],
			}),
		);
		expect(coordinator.get(instance.id as AgentSessionId)).toBeUndefined();
	});

	it('preserves a committed continuation marker across provider failure and warm retry', async () => {
		const sessionId = 'live-provider-retry-session' as AgentSessionId;
		const checkpoints = new Map<string, AgentCheckpoint>();
		const snapshotStore = createMockSnapshotStore(checkpoints);
		vi.mocked(snapshotStore.save).mockImplementation(async (checkpoint) => {
			checkpoints.set(checkpoint.session.id, structuredClone(checkpoint));
		});
		let capturedConfig: AdapterCreateConfig | undefined;
		const failedInstance = createMockAgentInstance(sessionId);
		failedInstance.checkpoint = vi.fn().mockResolvedValue(createMockCheckpoint(sessionId));
		failedInstance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				const checkpointHook = capturedConfig?.onCheckpoint;
				if (!checkpointHook) throw new Error('Expected checkpoint lifecycle callback');
				await checkpointHook(createContinuationCheckpoint(sessionId), 'tool_completed');
				yield {
					type: 'done' as const,
					result: {
						status: 'failed' as const,
						error: 'provider unavailable',
						metrics: { durationMs: 0, turns: 1, toolCalls: 1 },
					},
					timestamp: Date.now(),
				};
			},
		});
		const successfulInstance = createMockAgentInstance(sessionId);
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockImplementation(async (config: AdapterCreateConfig) => {
			capturedConfig = config;
			return failedInstance;
		});
		adapter.restore = vi.fn().mockResolvedValue(successfulInstance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });

		handle.start();
		await expect(handle.wait()).resolves.toMatchObject({ status: 'failed', error: 'provider unavailable' });
		const retryCheckpoint = await coordinator.loadCheckpoint(sessionId);

		expect(retryCheckpoint).toMatchObject({
			phase: 'continuation_pending',
			toolExecutions: [expect.objectContaining({ result: expect.any(Object) })],
		});
		expect(failedInstance.checkpoint).not.toHaveBeenCalled();
		expect(coordinator.get(sessionId)).toBeUndefined();

		await expect(coordinator.resumeContinuation(sessionId, adapter)).resolves.toEqual(
			expect.objectContaining({ id: sessionId }),
		);
		expect(adapter.restore).toHaveBeenCalledTimes(1);
		expect(successfulInstance.run).toHaveBeenCalledTimes(1);
		expect(checkpoints.get(sessionId)?.phase).toBeUndefined();
		expect(checkpoints.get(sessionId)?.toolExecutions).toEqual([]);
	});

	it('preserves a dormant resolved batch marker when its provider continuation fails', async () => {
		const sessionId = 'dormant-provider-retry-session' as AgentSessionId;
		const checkpoint = createSuspendedCheckpoint(sessionId);
		const suspendedStep = checkpoint.toolExecutions[0]?.suspendedStep;
		if (!suspendedStep) throw new Error('Expected a suspended execution');
		const resolution: PendingResolution = {
			suspensionId: suspendedStep.suspensionId,
			type: 'event',
			payload: { completed: true },
		};
		const acceptedCheckpoint = structuredClone(checkpoint);
		const acceptedExecution = acceptedCheckpoint.toolExecutions[0];
		if (!acceptedExecution?.suspendedStep) throw new Error('Expected an accepted suspended execution');
		acceptedExecution.suspendedStep.status = 'resolved';
		acceptedExecution.suspendedStep.resolution = resolution;
		acceptedExecution.suspendedStep.resumeData = {
			stepId: acceptedExecution.suspendedStep.stepId,
			outcome: { type: 'value', value: resolution.payload },
		};
		const completedCheckpoint = structuredClone(acceptedCheckpoint);
		const completedExecution = completedCheckpoint.toolExecutions[0];
		if (!completedExecution) throw new Error('Expected a completed suspended execution');
		completedExecution.result = {
			content: [{ type: 'text', text: 'completed' }],
			isError: false,
			completedAt: 7000,
		};

		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		vi.mocked(snapshotStore.save).mockImplementation(async (savedCheckpoint) => {
			checkpoints.set(savedCheckpoint.session.id, structuredClone(savedCheckpoint));
		});
		let capturedConfig: AdapterCreateConfig | undefined;
		const failedInstance = createMockAgentInstance(sessionId);
		failedInstance.checkpoint = vi.fn().mockResolvedValue(createMockCheckpoint(sessionId));
		failedInstance.resolve = vi.fn().mockImplementation(async () => {
			const checkpointHook = capturedConfig?.onCheckpoint;
			if (!checkpointHook) throw new Error('Expected checkpoint lifecycle callback');
			await checkpointHook(acceptedCheckpoint, 'resolution_accepted');
		});
		failedInstance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				const checkpointHook = capturedConfig?.onCheckpoint;
				if (!checkpointHook) throw new Error('Expected checkpoint lifecycle callback');
				await checkpointHook(completedCheckpoint, 'tool_completed');
				yield {
					type: 'done' as const,
					result: {
						status: 'failed' as const,
						error: 'provider unavailable',
						metrics: { durationMs: 0, turns: 1, toolCalls: 1 },
					},
					timestamp: Date.now(),
				};
			},
		});
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockImplementation(async (_savedCheckpoint, config: AdapterCreateConfig) => {
			capturedConfig = config;
			return failedInstance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		const handle = await coordinator.resolveSuspensions(sessionId, [resolution], adapter);
		await expect(handle.wait()).resolves.toMatchObject({ status: 'failed', error: 'provider unavailable' });
		const retryCheckpoint = await coordinator.loadCheckpoint(sessionId);

		expect(retryCheckpoint).toMatchObject({
			phase: 'continuation_pending',
			toolExecutions: [expect.objectContaining({ result: expect.any(Object) })],
		});
		expect(snapshotStore.save).toHaveBeenCalledTimes(2);
		expect(failedInstance.checkpoint).not.toHaveBeenCalled();
		expect(coordinator.get(sessionId)).toBeUndefined();
	});

	it('waits for ordinary terminal checkpoint persistence during shutdown', async () => {
		const sessionId = 'shutdown-terminal-checkpoint-session' as AgentSessionId;
		const checkpoints = new Map<string, AgentCheckpoint>();
		const snapshotStore = createMockSnapshotStore(checkpoints);
		let markSaveStarted: (() => void) | undefined;
		let releaseSave: (() => void) | undefined;
		const saveStarted = new Promise<void>((resolve) => {
			markSaveStarted = resolve;
		});
		const saveGate = new Promise<void>((resolve) => {
			releaseSave = resolve;
		});
		vi.mocked(snapshotStore.save).mockImplementation(async (checkpoint) => {
			markSaveStarted?.();
			await saveGate;
			checkpoints.set(checkpoint.session.id, structuredClone(checkpoint));
		});

		const instance = createMockAgentInstance(sessionId);
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockResolvedValue(instance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
		await handle.start();
		await saveStarted;

		let shutdownSettled = false;
		const shutdown = coordinator.shutdown({ graceful: false, timeoutMs: 1000 }).then(() => {
			shutdownSettled = true;
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(shutdownSettled).toBe(false);

		releaseSave?.();
		await shutdown;
		expect(shutdownSettled).toBe(true);
		expect(snapshotStore.save).toHaveBeenCalledTimes(1);
	});

	it('waits for done and persists when shutdown starts after completed status', async () => {
		const sessionId = 'shutdown-completed-status-gap-session' as AgentSessionId;
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, createMockCheckpoint(sessionId)]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		vi.mocked(snapshotStore.save).mockImplementation(async (checkpoint) => {
			checkpoints.set(checkpoint.session.id, structuredClone(checkpoint));
		});
		let markCompletedStatus: (() => void) | undefined;
		let releaseDone: (() => void) | undefined;
		const completedStatus = new Promise<void>((resolve) => {
			markCompletedStatus = resolve;
		});
		const doneGate = new Promise<void>((resolve) => {
			releaseDone = resolve;
		});
		const instance = createMockAgentInstance(sessionId);
		instance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield { type: 'status' as const, status: 'completed' as const, timestamp: Date.now() };
				markCompletedStatus?.();
				await doneGate;
				yield {
					type: 'done' as const,
					result: {
						status: 'completed' as const,
						output: 'completed before shutdown',
						metrics: { durationMs: 1, turns: 1, toolCalls: 0 },
					},
					timestamp: Date.now(),
				};
			},
		});
		vi.mocked(instance.checkpoint).mockResolvedValue({ ...createMockCheckpoint(sessionId), timestamp: 4242 });
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockResolvedValue(instance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
		const run = handle.start();
		await completedStatus;

		let shutdownSettled = false;
		const shutdown = coordinator.shutdown({ graceful: false, timeoutMs: 1000 }).then(() => {
			shutdownSettled = true;
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(shutdownSettled).toBe(false);
		expect(snapshotStore.save).not.toHaveBeenCalled();

		releaseDone?.();
		await run;
		await shutdown;
		expect(checkpoints.get(sessionId)?.timestamp).toBe(4242);
		expect(snapshotStore.save).toHaveBeenCalledTimes(1);
	});

	it('waits for a previous-lifecycle save tail before loading after restart', async () => {
		vi.useFakeTimers();
		try {
			const sessionId = 'restart-save-tail-session' as AgentSessionId;
			const initialCheckpoint = createMockCheckpoint(sessionId);
			const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, initialCheckpoint]]);
			const snapshotStore = createMockSnapshotStore(checkpoints);
			let markSaveStarted: (() => void) | undefined;
			let releaseSave: (() => void) | undefined;
			const saveStarted = new Promise<void>((resolve) => {
				markSaveStarted = resolve;
			});
			const saveGate = new Promise<void>((resolve) => {
				releaseSave = resolve;
			});
			vi.mocked(snapshotStore.save).mockImplementation(async (checkpoint) => {
				markSaveStarted?.();
				await saveGate;
				checkpoints.set(checkpoint.session.id, structuredClone(checkpoint));
			});

			const instance = createMockAgentInstance(sessionId);
			const terminalCheckpoint = { ...createMockCheckpoint(sessionId), timestamp: 4242 };
			vi.mocked(instance.checkpoint).mockResolvedValue(terminalCheckpoint);
			const adapter = createMockAdapter();
			adapter.create = vi.fn().mockResolvedValue(instance);
			const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
			await coordinator.start();
			const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
			await handle.start();
			await saveStarted;

			const shutdown = coordinator.shutdown({ graceful: false, timeoutMs: 25 });
			await vi.advanceTimersByTimeAsync(25);
			await shutdown;
			await coordinator.start();

			let loadSettled = false;
			const load = coordinator.loadCheckpoint(sessionId).then((checkpoint) => {
				loadSettled = true;
				return checkpoint;
			});
			await Promise.resolve();
			expect(loadSettled).toBe(false);
			expect(snapshotStore.load).not.toHaveBeenCalled();

			releaseSave?.();
			await expect(load).resolves.toMatchObject({ timestamp: 4242 });
			expect(snapshotStore.load).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('waits for previous-lifecycle terminal checkpoint generation before loading after restart', async () => {
		vi.useFakeTimers();
		try {
			const sessionId = 'restart-terminal-generation-session' as AgentSessionId;
			const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, createMockCheckpoint(sessionId)]]);
			const snapshotStore = createMockSnapshotStore(checkpoints);
			vi.mocked(snapshotStore.save).mockImplementation(async (checkpoint) => {
				checkpoints.set(checkpoint.session.id, structuredClone(checkpoint));
			});
			let markCheckpointStarted: (() => void) | undefined;
			let releaseCheckpoint: (() => void) | undefined;
			const checkpointStarted = new Promise<void>((resolve) => {
				markCheckpointStarted = resolve;
			});
			const checkpointGate = new Promise<void>((resolve) => {
				releaseCheckpoint = resolve;
			});
			const instance = createMockAgentInstance(sessionId);
			vi.mocked(instance.checkpoint).mockImplementation(async () => {
				markCheckpointStarted?.();
				await checkpointGate;
				return { ...createMockCheckpoint(sessionId), timestamp: 4242 };
			});
			let restoredTimestamp: number | undefined;
			const adapter = createMockAdapter((checkpoint) => {
				restoredTimestamp = checkpoint.timestamp;
			});
			adapter.create = vi.fn().mockResolvedValue(instance);
			const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
			await coordinator.start();
			const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
			await handle.start();
			await checkpointStarted;

			const shutdown = coordinator.shutdown({ graceful: false, timeoutMs: 25 });
			await vi.advanceTimersByTimeAsync(25);
			await shutdown;
			await coordinator.start();

			const continued = coordinator.continue(sessionId, { message: 'next turn' }, adapter);
			await Promise.resolve();
			expect(snapshotStore.load).not.toHaveBeenCalled();
			expect(adapter.restore).not.toHaveBeenCalled();

			releaseCheckpoint?.();
			await expect(continued).resolves.toEqual(expect.objectContaining({ id: sessionId }));
			expect(restoredTimestamp).toBe(4242);
			expect(snapshotStore.save).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('ignores a terminal event that arrives after the shutdown deadline and replacement', async () => {
		vi.useFakeTimers();
		try {
			const sessionId = 'replaced-before-done-session' as AgentSessionId;
			const snapshotStore = createMockSnapshotStore(
				new Map<string, AgentCheckpoint>([[sessionId, createMockCheckpoint(sessionId)]]),
			);
			let markCompletedStatus: (() => void) | undefined;
			let releaseDone: (() => void) | undefined;
			const completedStatus = new Promise<void>((resolve) => {
				markCompletedStatus = resolve;
			});
			const doneGate = new Promise<void>((resolve) => {
				releaseDone = resolve;
			});
			const oldInstance = createMockAgentInstance(sessionId);
			oldInstance.run = vi.fn().mockReturnValue({
				[Symbol.asyncIterator]: async function* () {
					yield { type: 'status' as const, status: 'completed' as const, timestamp: Date.now() };
					markCompletedStatus?.();
					await doneGate;
					yield {
						type: 'done' as const,
						result: {
							status: 'completed' as const,
							output: 'old result',
							metrics: { durationMs: 1, turns: 1, toolCalls: 0 },
						},
						timestamp: Date.now(),
					};
				},
			});
			const replacementInstance = createMockAgentInstance(sessionId);
			const adapter = createMockAdapter();
			adapter.create = vi.fn().mockResolvedValue(oldInstance);
			adapter.restore = vi.fn().mockResolvedValue(replacementInstance);
			const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
			await coordinator.start();
			const oldHandle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
			const oldRun = oldHandle.start();
			await completedStatus;
			const shutdown = coordinator.shutdown({ graceful: false, timeoutMs: 25 });
			await vi.advanceTimersByTimeAsync(25);
			await shutdown;
			await coordinator.start();

			const replacementHandle = await coordinator.continue(sessionId, { message: 'next' }, adapter);
			expect(coordinator.get(sessionId)).toBe(replacementHandle);

			releaseDone?.();
			await oldRun;
			await Promise.resolve();

			expect(oldInstance.checkpoint).not.toHaveBeenCalled();
			expect(snapshotStore.save).not.toHaveBeenCalled();
			expect(coordinator.get(sessionId)).toBe(replacementHandle);
		} finally {
			vi.useRealTimers();
		}
	});

	it('ignores late iterator completion after shutdown terminates an initializing handle', async () => {
		const sessionId = 'late-initializing-completion-session' as AgentSessionId;
		const snapshotStore = createMockSnapshotStore(new Map());
		let releaseNext: (() => void) | undefined;
		const nextGate = new Promise<void>((resolve) => {
			releaseNext = resolve;
		});
		let markNextStarted: (() => void) | undefined;
		const nextStarted = new Promise<void>((resolve) => {
			markNextStarted = resolve;
		});
		let nextIndex = 0;
		const instance = createMockAgentInstance(sessionId);
		instance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: () => ({
				next: async () => {
					if (nextIndex === 0) {
						nextIndex++;
						markNextStarted?.();
						await nextGate;
						return {
							done: false as const,
							value: { type: 'status' as const, status: 'completed' as const, timestamp: Date.now() },
						};
					}
					if (nextIndex === 1) {
						nextIndex++;
						return {
							done: false as const,
							value: {
								type: 'done' as const,
								result: {
									status: 'completed' as const,
									output: 'too late',
									metrics: { durationMs: 1, turns: 1, toolCalls: 0 },
								},
								timestamp: Date.now(),
							},
						};
					}
					return { done: true as const, value: undefined };
				},
				return: async () => ({ done: true as const, value: undefined }),
			}),
		});
		instance.abort = vi.fn().mockImplementation(() => releaseNext?.());
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockResolvedValue(instance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });

		const activeRun = handle.start();
		await nextStarted;
		expect(handle.status).toBe('initializing');

		await coordinator.shutdown({ graceful: false, timeoutMs: 1000 });
		await activeRun;

		expect(handle.status).toBe('terminated');
		expect(instance.abort).toHaveBeenCalledTimes(1);
		expect(instance.checkpoint).toHaveBeenCalledTimes(1);
		expect(snapshotStore.save).toHaveBeenCalledTimes(1);
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

	it('rejects lifecycle checkpoints when shutdown crosses or precedes their save', async () => {
		const sessionId = 'stale-lifecycle-checkpoint-session' as AgentSessionId;
		const checkpoints = new Map<string, AgentCheckpoint>();
		const snapshotStore = createMockSnapshotStore(checkpoints);
		let markFirstSaveStarted: (() => void) | undefined;
		let releaseFirstSave: (() => void) | undefined;
		const firstSaveStarted = new Promise<void>((resolve) => {
			markFirstSaveStarted = resolve;
		});
		const firstSaveGate = new Promise<void>((resolve) => {
			releaseFirstSave = resolve;
		});
		let saveCount = 0;
		vi.mocked(snapshotStore.save).mockImplementation(async (checkpoint) => {
			saveCount++;
			if (saveCount === 1) {
				markFirstSaveStarted?.();
				await firstSaveGate;
			}
			checkpoints.set(checkpoint.session.id, structuredClone(checkpoint));
		});

		const instance = createMockAgentInstance(sessionId);
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

		const crossingSave = capturedConfig.onCheckpoint(createSuspendedCheckpoint(sessionId), 'suspended');
		const crossingSaveRejected = expect(crossingSave).rejects.toThrow('coordinator lifecycle changed');
		await firstSaveStarted;
		const shutdown = coordinator.shutdown({ graceful: false, timeoutMs: 1000 });
		releaseFirstSave?.();

		await crossingSaveRejected;
		await shutdown;
		const savesAfterShutdown = vi.mocked(snapshotStore.save).mock.calls.length;
		await expect(capturedConfig.onCheckpoint(createSuspendedCheckpoint(sessionId), 'suspended')).rejects.toThrow(
			'coordinator lifecycle changed',
		);
		expect(snapshotStore.save).toHaveBeenCalledTimes(savesAfterShutdown);
	});

	it('rejects checkpoint callbacks from an untracked spawn during the graceful shutdown window', async () => {
		const snapshotStore = createMockSnapshotStore(new Map());
		let markRunning: (() => void) | undefined;
		let releaseRunning: (() => void) | undefined;
		const running = new Promise<void>((resolve) => {
			markRunning = resolve;
		});
		const runningGate = new Promise<void>((resolve) => {
			releaseRunning = resolve;
		});
		const trackedInstance = createMockAgentInstance('tracked-shutdown-session');
		trackedInstance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield { type: 'status' as const, status: 'running' as const, timestamp: Date.now() };
				markRunning?.();
				await runningGate;
				yield {
					type: 'done' as const,
					result: {
						status: 'completed' as const,
						metrics: { durationMs: 0, turns: 1, toolCalls: 0 },
					},
					timestamp: Date.now(),
				};
			},
		});
		const trackedAdapter = createMockAdapter();
		trackedAdapter.create = vi.fn().mockResolvedValue(trackedInstance);

		let untrackedConfig: AdapterCreateConfig | undefined;
		let markUntrackedCreate: (() => void) | undefined;
		let releaseUntrackedCreate: (() => void) | undefined;
		const untrackedCreate = new Promise<void>((resolve) => {
			markUntrackedCreate = resolve;
		});
		const untrackedCreateGate = new Promise<void>((resolve) => {
			releaseUntrackedCreate = resolve;
		});
		const untrackedInstance = createMockAgentInstance('untracked-shutdown-session');
		const untrackedAdapter = createMockAdapter();
		untrackedAdapter.create = vi.fn().mockImplementation(async (config: AdapterCreateConfig) => {
			untrackedConfig = config;
			markUntrackedCreate?.();
			await untrackedCreateGate;
			return untrackedInstance;
		});

		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const trackedHandle = await coordinator.spawn(trackedAdapter, { guidancePath: '/test/guidance' });
		const trackedRun = trackedHandle.start();
		await running;
		const lateSpawn = coordinator.spawn(untrackedAdapter, { guidancePath: '/test/guidance' });
		await untrackedCreate;
		if (!untrackedConfig?.onCheckpoint) throw new Error('Expected the untracked checkpoint callback');

		const shutdown = coordinator.shutdown({ graceful: true, timeoutMs: 1000 });
		expect(coordinator.status).toBe('stopping');
		await expect(
			untrackedConfig.onCheckpoint(
				createSuspendedCheckpoint(untrackedInstance.id as AgentSessionId),
				'suspended',
			),
		).rejects.toThrow('coordinator lifecycle changed');
		expect(snapshotStore.save).not.toHaveBeenCalled();

		releaseRunning?.();
		await trackedRun;
		await shutdown;
		releaseUntrackedCreate?.();
		await expect(lateSpawn).rejects.toThrow('coordinator lifecycle changed');
		expect(untrackedInstance.abort).toHaveBeenCalledTimes(1);
	});

	it('does not coalesce a suspended restore onto an earlier coordinator lifecycle', async () => {
		const sessionId = 'restore-lifecycle-coalescing-session' as AgentSessionId;
		const checkpoint = createSuspendedCheckpoint(sessionId);
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		let markOldRestoreStarted: (() => void) | undefined;
		let releaseOldRestore: (() => void) | undefined;
		const oldRestoreStarted = new Promise<void>((resolve) => {
			markOldRestoreStarted = resolve;
		});
		const oldRestoreGate = new Promise<void>((resolve) => {
			releaseOldRestore = resolve;
		});
		const oldInstance = createMockAgentInstance(sessionId);
		vi.mocked(oldInstance.status).mockReturnValue('waiting');
		const oldAdapter = createMockAdapter();
		oldAdapter.restore = vi.fn().mockImplementation(async () => {
			markOldRestoreStarted?.();
			await oldRestoreGate;
			return oldInstance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		const oldRestore = coordinator.restoreSuspended(sessionId, oldAdapter);
		const oldRestoreRejected = expect(oldRestore).rejects.toThrow('coordinator lifecycle changed');
		await oldRestoreStarted;
		await coordinator.shutdown({ graceful: false, timeoutMs: 25 });
		await coordinator.start();

		const freshInstance = createMockAgentInstance(sessionId);
		vi.mocked(freshInstance.status).mockReturnValue('waiting');
		const freshAdapter = createMockAdapter();
		freshAdapter.restore = vi.fn().mockResolvedValue(freshInstance);
		const freshHandle = await coordinator.restoreSuspended(sessionId, freshAdapter);
		expect(freshAdapter.restore).toHaveBeenCalledTimes(1);
		expect(coordinator.get(sessionId)).toBe(freshHandle);

		releaseOldRestore?.();
		await oldRestoreRejected;
		expect(oldInstance.abort).toHaveBeenCalledTimes(1);
		expect(coordinator.get(sessionId)).toBe(freshHandle);
	});

	it('does not coalesce continuation recovery after its old lifecycle drain times out', async () => {
		vi.useFakeTimers();
		try {
			const sessionId = 'resume-lifecycle-coalescing-session' as AgentSessionId;
			const checkpoint = createContinuationCheckpoint(sessionId);
			const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
			let markOldRestoreStarted: (() => void) | undefined;
			let releaseOldRestore: (() => void) | undefined;
			const oldRestoreStarted = new Promise<void>((resolve) => {
				markOldRestoreStarted = resolve;
			});
			const oldRestoreGate = new Promise<void>((resolve) => {
				releaseOldRestore = resolve;
			});
			const oldInstance = createMockAgentInstance(sessionId);
			const oldAdapter = createMockAdapter();
			oldAdapter.restore = vi.fn().mockImplementation(async () => {
				markOldRestoreStarted?.();
				await oldRestoreGate;
				return oldInstance;
			});
			const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
			await coordinator.start();

			const oldResume = coordinator.resumeContinuation(sessionId, oldAdapter);
			const oldResumeRejected = expect(oldResume).rejects.toThrow('coordinator lifecycle changed');
			await oldRestoreStarted;
			const shutdown = coordinator.shutdown({ graceful: false, timeoutMs: 25 });
			await vi.advanceTimersByTimeAsync(25);
			await shutdown;
			await coordinator.start();

			const freshInstance = createMockAgentInstance(sessionId);
			const freshAdapter = createMockAdapter();
			freshAdapter.restore = vi.fn().mockResolvedValue(freshInstance);
			const freshHandle = await coordinator.resumeContinuation(sessionId, freshAdapter);
			expect(freshAdapter.restore).toHaveBeenCalledTimes(1);
			expect(coordinator.get(sessionId)).toBe(freshHandle);

			releaseOldRestore?.();
			await oldResumeRejected;
			expect(oldInstance.abort).toHaveBeenCalledTimes(1);
			expect(coordinator.get(sessionId)).toBe(freshHandle);
		} finally {
			vi.useRealTimers();
		}
	});

	it('serializes lifecycle and terminal checkpoint saves for the same session', async () => {
		const snapshotStore = createMockSnapshotStore(new Map());
		let releaseLifecycleSave: (() => void) | undefined;
		let lifecycleSaveStarted: (() => void) | undefined;
		const lifecycleSaveBlocker = new Promise<void>((resolve) => {
			releaseLifecycleSave = resolve;
		});
		const lifecycleSaveStartedPromise = new Promise<void>((resolve) => {
			lifecycleSaveStarted = resolve;
		});
		const savedTimestamps: number[] = [];
		vi.mocked(snapshotStore.save).mockImplementation(async (checkpoint) => {
			savedTimestamps.push(checkpoint.timestamp);
			if (savedTimestamps.length === 1) {
				lifecycleSaveStarted?.();
				await lifecycleSaveBlocker;
			}
		});

		const instance = createMockAgentInstance('serialized-session');
		vi.mocked(instance.checkpoint).mockResolvedValue({
			...createMockCheckpoint(instance.id),
			timestamp: 2,
		});
		let capturedConfig: AdapterCreateConfig | undefined;
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockImplementation(async (config: AdapterCreateConfig) => {
			capturedConfig = config;
			return instance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
		if (!capturedConfig?.onCheckpoint) throw new Error('Expected checkpoint lifecycle callback');

		const lifecycleSave = capturedConfig.onCheckpoint(
			{ ...createMockCheckpoint(instance.id), timestamp: 1 },
			'suspended',
		);
		await lifecycleSaveStartedPromise;
		await handle.start();
		await new Promise<void>((resolve) => setImmediate(resolve));
		const savesBeforeRelease = [...savedTimestamps];

		releaseLifecycleSave?.();
		await lifecycleSave;
		await vi.waitFor(() => expect(savedTimestamps).toEqual([1, 2]));
		expect(savesBeforeRelease).toEqual([1]);
	});

	it('allows checkpoint saves for different sessions to proceed independently', async () => {
		const snapshotStore = createMockSnapshotStore(new Map());
		let releaseFirstSession: (() => void) | undefined;
		let firstSessionStarted: (() => void) | undefined;
		const firstSessionBlocker = new Promise<void>((resolve) => {
			releaseFirstSession = resolve;
		});
		const firstSessionStartedPromise = new Promise<void>((resolve) => {
			firstSessionStarted = resolve;
		});
		const savedSessions: string[] = [];
		vi.mocked(snapshotStore.save).mockImplementation(async (checkpoint) => {
			savedSessions.push(checkpoint.session.id);
			if (checkpoint.session.id === 'first-session') {
				firstSessionStarted?.();
				await firstSessionBlocker;
			}
		});

		const firstInstance = createMockAgentInstance('first-session');
		const secondInstance = createMockAgentInstance('second-session');
		const checkpointHooks: NonNullable<AdapterCreateConfig['onCheckpoint']>[] = [];
		const adapter = createMockAdapter();
		adapter.create = vi
			.fn()
			.mockImplementationOnce(async (config: AdapterCreateConfig) => {
				if (config.onCheckpoint) checkpointHooks.push(config.onCheckpoint);
				return firstInstance;
			})
			.mockImplementationOnce(async (config: AdapterCreateConfig) => {
				if (config.onCheckpoint) checkpointHooks.push(config.onCheckpoint);
				return secondInstance;
			});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
		await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
		const [firstHook, secondHook] = checkpointHooks;
		if (!firstHook || !secondHook) throw new Error('Expected checkpoint lifecycle callbacks');

		const firstSave = firstHook(createMockCheckpoint(firstInstance.id), 'suspended');
		await firstSessionStartedPromise;
		const secondSave = secondHook(createMockCheckpoint(secondInstance.id), 'suspended');
		await new Promise<void>((resolve) => setImmediate(resolve));
		const sessionsBeforeRelease = [...savedSessions];

		releaseFirstSession?.();
		await Promise.all([firstSave, secondSave]);
		expect(sessionsBeforeRelease).toEqual(['first-session', 'second-session']);
	});

	it('continues a session checkpoint queue after a rejected save', async () => {
		const snapshotStore = createMockSnapshotStore(new Map());
		const savedTimestamps: number[] = [];
		vi.mocked(snapshotStore.save).mockImplementation(async (checkpoint) => {
			savedTimestamps.push(checkpoint.timestamp);
			if (checkpoint.timestamp === 1) throw new Error('disk unavailable');
		});

		const instance = createMockAgentInstance('retry-session');
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

		const rejectedSave = capturedConfig.onCheckpoint(
			{ ...createMockCheckpoint(instance.id), timestamp: 1 },
			'suspended',
		);
		const retrySave = capturedConfig.onCheckpoint(
			{ ...createMockCheckpoint(instance.id), timestamp: 2 },
			'resolution_accepted',
		);

		await expect(rejectedSave).rejects.toThrow('disk unavailable');
		await expect(retrySave).resolves.toBeUndefined();
		expect(savedTimestamps).toEqual([1, 2]);
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

	it('rejects ordinary continuation while a model continuation is pending', async () => {
		const sessionId = 'continuation-pending-session' as AgentSessionId;
		const checkpoint = createContinuationCheckpoint(sessionId);
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		const adapter = createMockAdapter();
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		await expect(coordinator.continue(sessionId, { message: 'ordinary input' }, adapter)).rejects.toThrow(
			'pending model continuation',
		);
		expect(adapter.restore).not.toHaveBeenCalled();
	});

	it('rejects ordinary continuation while a durable batch replay is pending', async () => {
		const sessionId = 'batch-pending-session' as AgentSessionId;
		const checkpoint = createBatchPendingCheckpoint(sessionId);
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		const adapter = createMockAdapter();
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		await expect(coordinator.continue(sessionId, { message: 'ordinary input' }, adapter)).rejects.toThrow(
			'pending durable tool batch',
		);
		expect(adapter.restore).not.toHaveBeenCalled();
	});

	it('replays a batch-pending checkpoint whose suspended executions are complete', async () => {
		const sessionId = 'replayable-batch-pending-session' as AgentSessionId;
		const checkpoint = createBatchPendingCheckpoint(sessionId);
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		vi.mocked(snapshotStore.save).mockImplementation(async (savedCheckpoint) => {
			checkpoints.set(savedCheckpoint.session.id, structuredClone(savedCheckpoint));
		});
		const instance = createMockAgentInstance(sessionId);
		vi.mocked(instance.checkpoint).mockResolvedValue(createMockCheckpoint(sessionId));
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockImplementation(async (savedCheckpoint) => {
			expect(savedCheckpoint.phase).toBe('batch_pending');
			return instance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		await expect(coordinator.resumeContinuation(sessionId, adapter)).resolves.toEqual(
			expect.objectContaining({ id: sessionId }),
		);

		expect(instance.run).toHaveBeenCalledTimes(1);
		expect(checkpoints.get(sessionId)?.phase).toBeUndefined();
		expect(checkpoints.get(sessionId)?.toolExecutions).toEqual([]);
	});

	it('replays a legacy phase-undefined durable batch without waiting suspensions', async () => {
		const sessionId = 'legacy-replayable-batch-session' as AgentSessionId;
		const checkpoint = createBatchPendingCheckpoint(sessionId);
		delete checkpoint.phase;
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		vi.mocked(snapshotStore.save).mockImplementation(async (savedCheckpoint) => {
			checkpoints.set(savedCheckpoint.session.id, structuredClone(savedCheckpoint));
		});
		const instance = createMockAgentInstance(sessionId);
		vi.mocked(instance.checkpoint).mockResolvedValue(createMockCheckpoint(sessionId));
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockImplementation(async (savedCheckpoint) => {
			expect(savedCheckpoint.phase).toBeUndefined();
			return instance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		await expect(coordinator.resumeContinuation(sessionId, adapter)).resolves.toEqual(
			expect.objectContaining({ id: sessionId }),
		);

		expect(instance.run).toHaveBeenCalledTimes(1);
		expect(checkpoints.get(sessionId)?.toolExecutions).toEqual([]);
	});

	it('replays a batch-pending checkpoint with a durable accepted resolution', async () => {
		const sessionId = 'resolved-batch-pending-session' as AgentSessionId;
		const checkpoint = createSuspendedCheckpoint(sessionId);
		const execution = checkpoint.toolExecutions[0];
		if (!execution?.suspendedStep) throw new Error('Expected a suspended execution');
		const resolution: PendingResolution = {
			suspensionId: execution.suspendedStep.suspensionId,
			type: 'event',
			payload: { accepted: true },
		};
		execution.suspendedStep.status = 'resolved';
		execution.suspendedStep.resolution = resolution;
		execution.suspendedStep.resumeData = {
			stepId: execution.suspendedStep.stepId,
			outcome: { type: 'value', value: resolution.payload },
		};
		checkpoint.toolExecutions.push({
			toolName: 'finish-build',
			toolCallId: 'tool-call-2',
			input: { sha: 'def' },
			sourceOrder: 1,
			completedSteps: [],
		});
		checkpoint.phase = 'batch_pending';
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		vi.mocked(snapshotStore.save).mockImplementation(async (savedCheckpoint) => {
			checkpoints.set(savedCheckpoint.session.id, structuredClone(savedCheckpoint));
		});
		const instance = createMockAgentInstance(sessionId);
		vi.mocked(instance.checkpoint).mockResolvedValue(createMockCheckpoint(sessionId));
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockResolvedValue(instance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		await expect(coordinator.resumeContinuation(sessionId, adapter)).resolves.toEqual(
			expect.objectContaining({ id: sessionId }),
		);

		expect(instance.run).toHaveBeenCalledTimes(1);
		expect(checkpoints.get(sessionId)?.phase).toBeUndefined();
		expect(checkpoints.get(sessionId)?.toolExecutions).toEqual([]);
	});

	it('rejects direct batch replay while a suspended execution is unresolved', async () => {
		const sessionId = 'unresolved-batch-pending-session' as AgentSessionId;
		const checkpoint = createSuspendedCheckpoint(sessionId);
		checkpoint.phase = 'batch_pending';
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		const adapter = createMockAdapter();
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		await expect(coordinator.resumeContinuation(sessionId, adapter)).rejects.toThrow(
			'invalid continuation checkpoint',
		);
		expect(adapter.restore).not.toHaveBeenCalled();
	});

	it('rejects a cold resolution while continuation recovery owns the session', async () => {
		const sessionId = 'resume-before-resolution-session' as AgentSessionId;
		const checkpoint = createAcceptedResolutionBatchCheckpoint(sessionId);
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		let markRestoreStarted: (() => void) | undefined;
		let releaseRestore: (() => void) | undefined;
		const restoreStarted = new Promise<void>((resolve) => {
			markRestoreStarted = resolve;
		});
		const restoreGate = new Promise<void>((resolve) => {
			releaseRestore = resolve;
		});
		const instance = createMockAgentInstance(sessionId);
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockImplementation(async () => {
			markRestoreStarted?.();
			await restoreGate;
			return instance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const suspensionId = checkpoint.toolExecutions[0]?.suspendedStep?.suspensionId;
		if (!suspensionId) throw new Error('Expected a durable suspension identity');

		const resume = coordinator.resumeContinuation(sessionId, adapter);
		await restoreStarted;

		await expect(
			coordinator.resolveSuspensions(
				sessionId,
				[{ suspensionId, type: 'event', payload: { completed: true } }],
				adapter,
			),
		).rejects.toThrow(`Session ${sessionId} already has a recovery operation in progress`);
		expect(adapter.restore).toHaveBeenCalledTimes(1);
		expect(instance.resolve).not.toHaveBeenCalled();

		releaseRestore?.();
		await expect(resume).resolves.toEqual(expect.objectContaining({ id: sessionId }));
		expect(adapter.restore).toHaveBeenCalledTimes(1);
		expect(instance.run).toHaveBeenCalledTimes(1);
	});

	it('rejects continuation recovery while a cold resolution owns the session', async () => {
		const sessionId = 'resolution-before-resume-session' as AgentSessionId;
		const checkpoint = createAcceptedResolutionBatchCheckpoint(sessionId);
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		let markRestoreStarted: (() => void) | undefined;
		let releaseRestore: (() => void) | undefined;
		const restoreStarted = new Promise<void>((resolve) => {
			markRestoreStarted = resolve;
		});
		const restoreGate = new Promise<void>((resolve) => {
			releaseRestore = resolve;
		});
		const instance = createMockAgentInstance(sessionId);
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockImplementation(async () => {
			markRestoreStarted?.();
			await restoreGate;
			return instance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const suspensionId = checkpoint.toolExecutions[0]?.suspendedStep?.suspensionId;
		if (!suspensionId) throw new Error('Expected a durable suspension identity');
		const resolution: PendingResolution = {
			suspensionId,
			type: 'event',
			payload: { completed: true },
		};

		const resolving = coordinator.resolveSuspensions(sessionId, [resolution], adapter);
		await restoreStarted;

		await expect(coordinator.resumeContinuation(sessionId, adapter)).rejects.toThrow(
			`Session ${sessionId} already has a recovery operation in progress`,
		);
		expect(adapter.restore).toHaveBeenCalledTimes(1);

		releaseRestore?.();
		await expect(resolving).resolves.toEqual(expect.objectContaining({ id: sessionId }));
		expect(adapter.restore).toHaveBeenCalledTimes(1);
		expect(instance.resolve).toHaveBeenCalledTimes(1);
		expect(instance.resolve).toHaveBeenCalledWith([resolution]);
		expect(instance.run).toHaveBeenCalledTimes(1);
	});

	it('resolves a tracked suspension while continuation recovery has an active sibling', async () => {
		const sessionId = 'warm-resolution-during-resume-session' as AgentSessionId;
		const checkpoint = createContinuationCheckpoint(sessionId);
		const suspendedStep = checkpoint.toolExecutions[0]?.suspendedStep;
		if (!suspendedStep) throw new Error('Expected a suspended execution');
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		const pendingRequest: PendingRequestInfo = {
			suspensionId: suspendedStep.suspensionId,
			toolCallId: 'tool-call-1',
			toolName: 'wait-for-build',
			stepId: suspendedStep.stepId,
			type: 'event',
			request: { type: 'event', eventName: 'build.completed' },
			suspendedAt: suspendedStep.suspendedAt,
			deadline: suspendedStep.deadline,
			status: 'waiting',
		};
		let markRunStarted: (() => void) | undefined;
		let releaseRun: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const runGate = new Promise<void>((resolve) => {
			releaseRun = resolve;
		});
		const instance = createMockAgentInstance(sessionId);
		instance.getPendingRequests = vi.fn().mockReturnValue([pendingRequest]);
		instance.resolve = vi.fn().mockImplementation(() => {
			releaseRun?.();
		});
		instance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield { type: 'status' as const, status: 'running' as const, timestamp: Date.now() };
				markRunStarted?.();
				await runGate;
				yield {
					type: 'done' as const,
					result: {
						status: 'completed' as const,
						metrics: { durationMs: 0, turns: 1, toolCalls: 1 },
					},
					timestamp: Date.now(),
				};
			},
		});
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockResolvedValue(instance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const resolution: PendingResolution = {
			suspensionId: pendingRequest.suspensionId,
			type: 'event',
			payload: { completed: true },
		};

		const resume = coordinator.resumeContinuation(sessionId, adapter);
		await runStarted;
		const resolvedHandle = await coordinator.resolveSuspensions(sessionId, [resolution], adapter);
		const resumedHandle = await resume;

		expect(resolvedHandle).toBe(resumedHandle);
		expect(adapter.restore).toHaveBeenCalledTimes(1);
		expect(instance.resolve).toHaveBeenCalledTimes(1);
		expect(instance.resolve).toHaveBeenCalledWith([resolution]);
		expect(instance.run).toHaveBeenCalledTimes(1);
	});

	it('coalesces cold continuation recovery and persists completion before returning', async () => {
		const sessionId = 'coalesced-continuation-session' as AgentSessionId;
		const checkpoint = createContinuationCheckpoint(sessionId);
		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		const tools = createMockToolRegistry();
		let releaseRun: (() => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runGate = new Promise<void>((resolve) => {
			releaseRun = resolve;
		});
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const instance = createMockAgentInstance(sessionId);
		instance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				markRunStarted?.();
				await runGate;
				yield {
					type: 'done' as const,
					result: {
						status: 'completed' as const,
						output: 'continued',
						metrics: { durationMs: 0, turns: 1, toolCalls: 0 },
					},
					timestamp: Date.now(),
				};
			},
		});
		const completedCheckpoint = createMockCheckpoint(sessionId);
		instance.checkpoint = vi.fn().mockResolvedValue(completedCheckpoint);
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockImplementation(async (savedCheckpoint, config: AdapterCreateConfig) => {
			expect(savedCheckpoint.phase).toBe('continuation_pending');
			expect(config.input).toBeUndefined();
			expect(config.contextInjection).toBeUndefined();
			expect(config.tools).toBe(tools);
			return instance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		const firstResume = coordinator.resumeContinuation(sessionId, adapter, { tools });
		const secondResume = coordinator.resumeContinuation(sessionId, adapter, { tools });
		await runStarted;
		expect(adapter.restore).toHaveBeenCalledTimes(1);
		releaseRun?.();
		const [firstHandle, secondHandle] = await Promise.all([firstResume, secondResume]);

		expect(firstHandle).toBe(secondHandle);
		expect(instance.run).toHaveBeenCalledTimes(1);
		const finalCheckpoint = vi.mocked(snapshotStore.save).mock.calls.at(-1)?.[0];
		expect(finalCheckpoint?.phase).toBeUndefined();
		expect(finalCheckpoint?.toolExecutions).toEqual([]);
	});

	it('returns a re-suspended recovered continuation and transfers terminal checkpoint ownership', async () => {
		const sessionId = 're-suspended-continuation-session' as AgentSessionId;
		const checkpoint = createContinuationCheckpoint(sessionId);
		const reSuspendedCheckpoint = createSuspendedCheckpoint(sessionId);
		const reSuspendedStep = reSuspendedCheckpoint.toolExecutions[0]?.suspendedStep;
		if (!reSuspendedStep) throw new Error('Expected the recovered continuation to suspend');
		const pendingRequest: PendingRequestInfo = {
			suspensionId: reSuspendedStep.suspensionId,
			toolCallId: 'tool-call-1',
			toolName: 'wait-for-build',
			stepId: reSuspendedStep.stepId,
			type: 'event',
			request: { type: 'event', eventName: 'build.completed', timeout: 5000 },
			suspendedAt: reSuspendedStep.suspendedAt,
			deadline: reSuspendedStep.deadline,
			status: 'waiting',
		};
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		vi.mocked(snapshotStore.save).mockImplementation(async (savedCheckpoint) => {
			checkpoints.set(savedCheckpoint.session.id, structuredClone(savedCheckpoint));
		});

		let capturedConfig: AdapterCreateConfig | undefined;
		let releaseRun: (() => void) | undefined;
		const runGate = new Promise<void>((resolve) => {
			releaseRun = resolve;
		});
		let markResolutionAccepted: (() => void) | undefined;
		const resolutionAccepted = new Promise<void>((resolve) => {
			markResolutionAccepted = resolve;
		});
		let releaseResolution: (() => void) | undefined;
		const resolutionGate = new Promise<void>((resolve) => {
			releaseResolution = resolve;
		});
		let hasPendingRequest = true;
		const instance = createMockAgentInstance(sessionId);
		instance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				const checkpointHook = capturedConfig?.onCheckpoint;
				if (!checkpointHook) throw new Error('Expected checkpoint lifecycle callback');
				await checkpointHook(reSuspendedCheckpoint, 'suspended');
				yield { type: 'status' as const, status: 'waiting' as const, timestamp: Date.now() };
				await runGate;
				yield { type: 'status' as const, status: 'running' as const, timestamp: Date.now() };
				yield {
					type: 'done' as const,
					result: {
						status: 'completed' as const,
						output: 'continued after second suspension',
						metrics: { durationMs: 0, turns: 2, toolCalls: 1 },
					},
					timestamp: Date.now(),
				};
			},
		});
		instance.getPendingRequests = vi.fn(() => (hasPendingRequest ? [pendingRequest] : []));
		const completedCheckpoint = createMockCheckpoint(sessionId);
		instance.checkpoint = vi.fn().mockResolvedValue(completedCheckpoint);
		instance.resolve = vi.fn().mockImplementation(async (resolutions: PendingResolution[]) => {
			const resolution = resolutions[0];
			if (!resolution || resolution.suspensionId !== pendingRequest.suspensionId) {
				throw new Error('Expected the new suspension resolution');
			}
			if (!reSuspendedStep) throw new Error('Expected the recovered suspension');
			reSuspendedStep.status = 'resolved';
			reSuspendedStep.resolution = resolution;
			await capturedConfig?.onCheckpoint?.(reSuspendedCheckpoint, 'resolution_accepted');
			markResolutionAccepted?.();
			await resolutionGate;
			hasPendingRequest = false;
			releaseRun?.();
		});
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockImplementation(async (_savedCheckpoint, config: AdapterCreateConfig) => {
			capturedConfig = config;
			return instance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		let immediateResolution: Promise<unknown> | undefined;
		coordinator.subscribe((event) => {
			if (event.type === 'agent_event' && event.event.type === 'status' && event.event.status === 'waiting') {
				immediateResolution = coordinator.resolveSuspensions(
					sessionId,
					[{ suspensionId: pendingRequest.suspensionId, type: 'event', payload: 'accepted' }],
					adapter,
				);
			}
		});

		const handle = await coordinator.resumeContinuation(sessionId, adapter);
		await resolutionAccepted;

		expect(handle.status).toBe('waiting');
		expect(handle.getPendingRequests()).toEqual([pendingRequest]);
		expect(checkpoints.get(sessionId)?.phase).toBe('batch_pending');
		expect(checkpoints.get(sessionId)).toMatchObject({
			toolExecutions: [
				expect.objectContaining({ suspendedStep: expect.objectContaining({ status: 'resolved' }) }),
			],
		});

		releaseResolution?.();
		await immediateResolution;
		await expect(handle.wait()).resolves.toMatchObject({
			status: 'completed',
			output: 'continued after second suspension',
		});
		await vi.waitFor(() => {
			expect(checkpoints.get(sessionId)?.toolExecutions).toEqual([]);
		});
		expect(instance.run).toHaveBeenCalledTimes(1);
	});

	it('leaves the continuation marker unchanged after a failed recovered model turn', async () => {
		const sessionId = 'failed-continuation-session' as AgentSessionId;
		const checkpoint = createContinuationCheckpoint(sessionId);
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		vi.mocked(snapshotStore.save).mockImplementation(async (savedCheckpoint) => {
			checkpoints.set(savedCheckpoint.session.id, structuredClone(savedCheckpoint));
		});
		const failedInstance = createMockAgentInstance(sessionId);
		failedInstance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield {
					type: 'done' as const,
					result: {
						status: 'failed' as const,
						error: 'provider unavailable',
						metrics: { durationMs: 0, turns: 1, toolCalls: 0 },
					},
					timestamp: Date.now(),
				};
			},
		});
		failedInstance.checkpoint = vi.fn().mockResolvedValue(createMockCheckpoint(sessionId));
		const successfulInstance = createMockAgentInstance(sessionId);
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockResolvedValueOnce(failedInstance).mockResolvedValueOnce(successfulInstance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		await expect(coordinator.resumeContinuation(sessionId, adapter)).rejects.toThrow(
			'continuation ended with status failed',
		);
		expect(failedInstance.checkpoint).not.toHaveBeenCalled();
		expect(snapshotStore.save).not.toHaveBeenCalled();
		expect(checkpoints.get(sessionId)).toBe(checkpoint);
		expect(coordinator.get(sessionId)).toBeUndefined();

		await expect(coordinator.resumeContinuation(sessionId, adapter)).resolves.toEqual(
			expect.objectContaining({
				id: sessionId,
			}),
		);
		expect(adapter.restore).toHaveBeenCalledTimes(2);
		expect(vi.mocked(snapshotStore.save).mock.calls.map(([savedCheckpoint]) => savedCheckpoint.phase)).toEqual([
			undefined,
		]);
	});

	it('does not overwrite newer durable batch progress when recovered replay later fails', async () => {
		const sessionId = 'failed-after-newer-batch-session' as AgentSessionId;
		const originalCheckpoint = createContinuationCheckpoint(sessionId);
		const newerCheckpoint = createBatchPendingCheckpoint(sessionId);
		const laterCheckpoint = structuredClone(newerCheckpoint);
		const laterSibling = laterCheckpoint.toolExecutions[1];
		if (!laterSibling) throw new Error('Expected an unfinished ordinary sibling');
		laterSibling.result = {
			content: [{ type: 'text', text: 'completed' }],
			isError: false,
			completedAt: 8000,
		};
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, originalCheckpoint]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		let saveCount = 0;
		vi.mocked(snapshotStore.save).mockImplementation(async (savedCheckpoint) => {
			saveCount++;
			if (saveCount === 2) throw new Error('disk unavailable');
			checkpoints.set(savedCheckpoint.session.id, structuredClone(savedCheckpoint));
		});
		let capturedConfig: AdapterCreateConfig | undefined;
		const failedInstance = createMockAgentInstance(sessionId);
		failedInstance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield { type: 'status' as const, status: 'running' as const, timestamp: Date.now() };
				const checkpointHook = capturedConfig?.onCheckpoint;
				if (!checkpointHook) throw new Error('Expected checkpoint lifecycle callback');
				await checkpointHook(newerCheckpoint, 'tool_completed');
				await checkpointHook(laterCheckpoint, 'tool_completed');
			},
		});
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockImplementation(async (_checkpoint, config: AdapterCreateConfig) => {
			capturedConfig = config;
			return failedInstance;
		});
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		await expect(coordinator.resumeContinuation(sessionId, adapter)).rejects.toThrow(
			'continuation ended with status running',
		);

		expect(snapshotStore.save).toHaveBeenCalledTimes(2);
		expect(checkpoints.get(sessionId)).toMatchObject({
			phase: 'batch_pending',
			toolExecutions: [
				expect.objectContaining({ result: expect.any(Object) }),
				expect.not.objectContaining({ result: expect.anything() }),
			],
		});
		expect(coordinator.get(sessionId)).toBeUndefined();
	});

	it('persists cleared terminal state when shutdown terminates continuation recovery', async () => {
		const sessionId = 'terminated-continuation-session' as AgentSessionId;
		const checkpoint = createContinuationCheckpoint(sessionId);
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		let markSaveStarted: (() => void) | undefined;
		let releaseSave: (() => void) | undefined;
		const saveStarted = new Promise<void>((resolve) => {
			markSaveStarted = resolve;
		});
		const saveGate = new Promise<void>((resolve) => {
			releaseSave = resolve;
		});
		vi.mocked(snapshotStore.save).mockImplementation(async (savedCheckpoint) => {
			markSaveStarted?.();
			await saveGate;
			checkpoints.set(savedCheckpoint.session.id, structuredClone(savedCheckpoint));
		});
		let markRunStarted: (() => void) | undefined;
		let releaseRun: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const runGate = new Promise<void>((resolve) => {
			releaseRun = resolve;
		});
		const instance = createMockAgentInstance(sessionId);
		instance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield { type: 'status' as const, status: 'running' as const, timestamp: Date.now() };
				markRunStarted?.();
				await runGate;
			},
		});
		instance.abort = vi.fn().mockImplementation(() => {
			releaseRun?.();
		});
		const terminalCheckpoint = createMockCheckpoint(sessionId);
		instance.checkpoint = vi.fn().mockResolvedValue(terminalCheckpoint);
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockResolvedValue(instance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		const resume = coordinator.resumeContinuation(sessionId, adapter);
		const resumeRejected = expect(resume).rejects.toThrow('continuation ended with status terminated');
		await runStarted;
		let shutdownSettled = false;
		const shutdown = coordinator.shutdown({ graceful: false, timeoutMs: 1000 }).then(() => {
			shutdownSettled = true;
		});
		await saveStarted;
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(shutdownSettled).toBe(false);

		releaseSave?.();
		await shutdown;
		await resumeRejected;
		expect(instance.abort).toHaveBeenCalledTimes(1);
		expect(instance.checkpoint).toHaveBeenCalledTimes(1);
		expect(snapshotStore.save).toHaveBeenCalledTimes(1);
		const savedCheckpoint = checkpoints.get(sessionId);
		expect(savedCheckpoint?.phase).toBeUndefined();
		expect(savedCheckpoint?.toolExecutions).toEqual([]);
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

	it('coalesces concurrent cold resolutions onto one restored session', async () => {
		const sessionId = 'concurrent-cold-resolution-session' as AgentSessionId;
		const checkpoint = createSuspendedCheckpoint(sessionId);
		const secondStepId = '__suspension:event:deploy:0';
		const secondSuspensionId = createSuspensionId('tool-call-2', secondStepId);
		checkpoint.toolExecutions.push({
			toolName: 'wait-for-deploy',
			toolCallId: 'tool-call-2',
			input: { environment: 'production' },
			sourceOrder: 1,
			completedSteps: [{ stepId: 'prepare-deploy', result: 'ready', completedAt: 200 }],
			suspendedStep: {
				suspensionId: secondSuspensionId,
				stepId: secondStepId,
				request: { type: 'event', eventName: 'deploy.completed' },
				suspendedAt: 2000,
				status: 'waiting',
			},
		});
		const firstExecution = checkpoint.toolExecutions[0];
		const firstSuspensionId = firstExecution?.suspendedStep?.suspensionId;
		if (!firstExecution || !firstSuspensionId) throw new Error('Expected the first suspended execution');
		firstExecution.sourceOrder = 0;
		const resolveSecond: PendingResolution = {
			suspensionId: secondSuspensionId,
			type: 'event',
			payload: { sequence: 2 },
		};
		const resolveFirst: PendingResolution = {
			suspensionId: firstSuspensionId,
			type: 'event',
			payload: { sequence: 1 },
		};

		const snapshotStore = createMockSnapshotStore(new Map([[sessionId, checkpoint]]));
		const savedCheckpoints: AgentCheckpoint[] = [];
		vi.mocked(snapshotStore.save).mockImplementation(async (savedCheckpoint) => {
			savedCheckpoints.push(structuredClone(savedCheckpoint));
		});

		let releaseRestore: (() => void) | undefined;
		const restoreGate = new Promise<void>((resolve) => {
			releaseRestore = resolve;
		});
		const restoredInstances: AgentInstance[] = [];
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockImplementation(async (_savedCheckpoint, config: AdapterCreateConfig) => {
			await restoreGate;
			const localCheckpoint = structuredClone(checkpoint);
			const instance = createMockAgentInstance(sessionId);
			instance.run = vi.fn().mockReturnValue({
				[Symbol.asyncIterator]: async function* () {
					// Resolution starts replay on the shared handle, but this test only
					// exercises coordinator restoration and lifecycle serialization.
				},
			});
			instance.resolve = vi.fn().mockImplementation(async (resolutions: PendingResolution[]) => {
				for (const resolution of resolutions) {
					const execution = localCheckpoint.toolExecutions.find(
						(candidate) => candidate.suspendedStep?.suspensionId === resolution.suspensionId,
					);
					if (!execution?.suspendedStep) throw new Error('Resolution did not target this restored instance');
					execution.suspendedStep.status = 'resolved';
					execution.suspendedStep.resolution = resolution;
				}
				await config.onCheckpoint?.(structuredClone(localCheckpoint), 'resolution_accepted');
			});
			restoredInstances.push(instance);
			return instance;
		});

		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		const secondResolution = coordinator.resolveSuspensions(sessionId, [resolveSecond], adapter);
		const firstResolution = coordinator.resolveSuspensions(sessionId, [resolveFirst], adapter);
		await vi.waitFor(() => expect(adapter.restore).toHaveBeenCalledTimes(1));
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(adapter.restore).toHaveBeenCalledTimes(1);
		releaseRestore?.();

		const [secondHandle, firstHandle] = await Promise.all([secondResolution, firstResolution]);
		const [sharedInstance] = restoredInstances;
		if (!sharedInstance) throw new Error('Expected one restored instance');

		expect(restoredInstances).toHaveLength(1);
		expect(secondHandle).toBe(firstHandle);
		expect(coordinator.get(sessionId)).toBe(secondHandle);
		expect(sharedInstance.resolve).toHaveBeenNthCalledWith(1, [resolveSecond]);
		expect(sharedInstance.resolve).toHaveBeenNthCalledWith(2, [resolveFirst]);
		expect(savedCheckpoints).toHaveLength(2);
		expect(
			savedCheckpoints.map((savedCheckpoint) =>
				savedCheckpoint.toolExecutions.map((execution) => execution.suspendedStep?.status),
			),
		).toEqual([
			['waiting', 'resolved'],
			['resolved', 'resolved'],
		]);
	});

	it('terminates every snapshotted sibling before awaiting any termination', async () => {
		const snapshotStore = createMockSnapshotStore(new Map());
		let markFirstRunning: (() => void) | undefined;
		let releaseFirstRun: (() => void) | undefined;
		const firstRunning = new Promise<void>((resolve) => {
			markFirstRunning = resolve;
		});
		const firstRunGate = new Promise<void>((resolve) => {
			releaseFirstRun = resolve;
		});
		const firstInstance = createMockAgentInstance('first-termination-sibling');
		firstInstance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield { type: 'status' as const, status: 'running' as const, timestamp: Date.now() };
				markFirstRunning?.();
				await firstRunGate;
			},
		});
		firstInstance.abort = vi.fn().mockImplementation(() => {
			releaseFirstRun?.();
		});

		let markSecondRunning: (() => void) | undefined;
		let releaseSecondProgress: (() => void) | undefined;
		let releaseSecondDone: (() => void) | undefined;
		let markSecondTransition: (() => void) | undefined;
		const secondRunning = new Promise<void>((resolve) => {
			markSecondRunning = resolve;
		});
		const secondProgressGate = new Promise<void>((resolve) => {
			releaseSecondProgress = resolve;
		});
		const secondDoneGate = new Promise<void>((resolve) => {
			releaseSecondDone = resolve;
		});
		const secondTransition = new Promise<void>((resolve) => {
			markSecondTransition = resolve;
		});
		const secondInstance = createMockAgentInstance('second-termination-sibling');
		secondInstance.run = vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: async function* () {
				yield { type: 'status' as const, status: 'running' as const, timestamp: Date.now() };
				markSecondRunning?.();
				await secondProgressGate;
				yield { type: 'status' as const, status: 'completed' as const, timestamp: Date.now() };
				await secondDoneGate;
				yield {
					type: 'done' as const,
					result: {
						status: 'completed' as const,
						metrics: { durationMs: 0, turns: 1, toolCalls: 0 },
					},
					timestamp: Date.now(),
				};
			},
		});
		secondInstance.abort = vi.fn().mockImplementation(() => {
			markSecondTransition?.();
			releaseSecondProgress?.();
			releaseSecondDone?.();
		});

		const firstAdapter = createMockAdapter();
		firstAdapter.create = vi.fn().mockResolvedValue(firstInstance);
		const secondAdapter = createMockAdapter();
		secondAdapter.create = vi.fn().mockResolvedValue(secondInstance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const firstHandle = await coordinator.spawn(firstAdapter, { guidancePath: '/test/guidance' });
		const secondHandle = await coordinator.spawn(secondAdapter, { guidancePath: '/test/guidance' });
		firstHandle.start();
		secondHandle.start();
		await Promise.all([firstRunning, secondRunning]);
		const disposeSecondSubscription = secondHandle.subscribe((event) => {
			if (event.type === 'status' && event.status === 'completed') markSecondTransition?.();
		});
		const originalFirstTerminate = firstHandle.terminate.bind(firstHandle);
		firstHandle.terminate = vi.fn(async (reason?: string) => {
			await originalFirstTerminate(reason);
			releaseSecondProgress?.();
			await secondTransition;
		});

		await coordinator.shutdown({ graceful: false, timeoutMs: 1000 });

		releaseSecondDone?.();
		await Promise.all([firstHandle.wait(), secondHandle.wait()]);
		disposeSecondSubscription();
		expect(firstInstance.abort).toHaveBeenCalledTimes(1);
		expect(secondInstance.abort).toHaveBeenCalledTimes(1);
		expect(secondHandle.status).toBe('terminated');
	});

	it('terminates an unstarted initializing handle during shutdown', async () => {
		const sessionId = 'initializing-shutdown-session' as AgentSessionId;
		const snapshotStore = createMockSnapshotStore(new Map());
		const instance = createMockAgentInstance(sessionId);
		const adapter = createMockAdapter();
		adapter.create = vi.fn().mockResolvedValue(instance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();
		const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });

		expect(handle.status).toBe('initializing');

		await coordinator.shutdown({ graceful: false, timeoutMs: 1000 });

		expect(handle.status).toBe('terminated');
		expect(instance.abort).toHaveBeenCalledTimes(1);
		expect(instance.run).not.toHaveBeenCalled();
	});

	it('detaches an unstarted cold Pi-style waiting restore without aborting its suspension', async () => {
		const sessionId = 'cold-waiting-shutdown-session' as AgentSessionId;
		const checkpoint = createSuspendedCheckpoint(sessionId);
		const checkpoints = new Map<string, AgentCheckpoint>([[sessionId, checkpoint]]);
		const snapshotStore = createMockSnapshotStore(checkpoints);
		vi.mocked(snapshotStore.save).mockImplementation(async (savedCheckpoint) => {
			checkpoints.set(savedCheckpoint.session.id, structuredClone(savedCheckpoint));
		});
		const instance = createMockAgentInstance(sessionId);
		vi.mocked(instance.status).mockReturnValue('waiting');
		vi.mocked(instance.checkpoint).mockResolvedValue(checkpoint);
		const adapter = createMockAdapter();
		adapter.restore = vi.fn().mockResolvedValue(instance);
		const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
		await coordinator.start();

		const handle = await coordinator.restoreSuspended(sessionId, adapter);

		expect(handle.status).toBe('waiting');
		expect(instance.run).not.toHaveBeenCalled();
		await coordinator.shutdown({ graceful: false, timeoutMs: 1000 });

		expect(instance.abort).not.toHaveBeenCalled();
		expect(instance.run).not.toHaveBeenCalled();
		expect(coordinator.get(sessionId)).toBeUndefined();
		expect(checkpoints.get(sessionId)?.toolExecutions[0]?.suspendedStep?.status).toBe('waiting');
	});

	it('lets an active sibling checkpoint and park during graceful shutdown', async () => {
		vi.useFakeTimers();
		try {
			const sessionId = 'shutdown-active-sibling-session' as AgentSessionId;
			const snapshotStore = createMockSnapshotStore(new Map());
			const checkpoint = createSuspendedCheckpoint(sessionId);
			checkpoint.toolExecutions.push({
				toolName: 'complete-build',
				toolCallId: 'tool-call-2',
				input: { sha: 'def' },
				completedSteps: [],
				result: {
					content: [{ type: 'text', text: 'completed' }],
					isError: false,
					completedAt: 7000,
				},
			});
			let markSiblingActive: (() => void) | undefined;
			let releaseSibling: (() => void) | undefined;
			const siblingActive = new Promise<void>((resolve) => {
				markSiblingActive = resolve;
			});
			const siblingGate = new Promise<void>((resolve) => {
				releaseSibling = resolve;
			});
			let capturedConfig: AdapterCreateConfig | undefined;
			let lifecycleError: unknown;
			const instance = createMockAgentInstance(sessionId);
			vi.mocked(instance.checkpoint).mockResolvedValue(checkpoint);
			instance.run = vi.fn().mockReturnValue({
				[Symbol.asyncIterator]: async function* () {
					yield { type: 'status' as const, status: 'running' as const, timestamp: Date.now() };
					markSiblingActive?.();
					await siblingGate;
					const checkpointHook = capturedConfig?.onCheckpoint;
					if (!checkpointHook) throw new Error('Expected checkpoint lifecycle callback');
					try {
						await checkpointHook(checkpoint, 'tool_completed');
					} catch (error) {
						lifecycleError = error;
						throw error;
					}
					yield { type: 'status' as const, status: 'waiting' as const, timestamp: Date.now() };
				},
			});
			const adapter = createMockAdapter();
			adapter.create = vi.fn().mockImplementation(async (config: AdapterCreateConfig) => {
				capturedConfig = config;
				return instance;
			});
			const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
			await coordinator.start();
			const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
			const activeRun = handle.start();
			await siblingActive;

			let shutdownSettled = false;
			const shutdown = coordinator.shutdown({ graceful: true, timeoutMs: 25 }).then(() => {
				shutdownSettled = true;
			});
			expect(coordinator.status).toBe('stopping');
			expect(shutdownSettled).toBe(false);

			releaseSibling?.();
			await activeRun;
			await Promise.resolve();
			await Promise.resolve();
			if (!shutdownSettled) await vi.advanceTimersByTimeAsync(25);
			await shutdown;

			expect(lifecycleError).toBeUndefined();
			expect(handle.status).toBe('waiting');
			expect(snapshotStore.save).toHaveBeenCalledTimes(2);
			expect(instance.abort).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
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

		await coordinator.shutdown({ graceful: true, timeoutMs: 1000 });

		expect(snapshotStore.save).toHaveBeenCalled();
		expect(instance.abort).not.toHaveBeenCalled();
	});

	it('uses one timeout budget for graceful settling and persistence draining', async () => {
		vi.useFakeTimers();
		try {
			const sessionId = 'single-shutdown-deadline-session' as AgentSessionId;
			const snapshotStore = createMockSnapshotStore(new Map());
			let markRunning: (() => void) | undefined;
			let releaseRunning: (() => void) | undefined;
			const running = new Promise<void>((resolve) => {
				markRunning = resolve;
			});
			const runningGate = new Promise<void>((resolve) => {
				releaseRunning = resolve;
			});
			let markSaveStarted: (() => void) | undefined;
			const saveStarted = new Promise<void>((resolve) => {
				markSaveStarted = resolve;
			});
			vi.mocked(snapshotStore.save).mockImplementation(async () => {
				markSaveStarted?.();
				await new Promise<never>(() => {});
			});
			const instance = createMockAgentInstance(sessionId);
			vi.mocked(instance.checkpoint).mockResolvedValue(createSuspendedCheckpoint(sessionId));
			instance.run = vi.fn().mockReturnValue({
				[Symbol.asyncIterator]: async function* () {
					yield { type: 'status' as const, status: 'running' as const, timestamp: Date.now() };
					markRunning?.();
					await runningGate;
					yield { type: 'status' as const, status: 'waiting' as const, timestamp: Date.now() };
				},
			});
			const adapter = createMockAdapter();
			adapter.create = vi.fn().mockResolvedValue(instance);
			const coordinator = createCoordinator({ snapshotStore, defaultGuidancePath: '/test/guidance' });
			await coordinator.start();
			const handle = await coordinator.spawn(adapter, { guidancePath: '/test/guidance' });
			const run = handle.start();
			await running;
			const shutdownStartedAt = Date.now();
			let shutdownSettled = false;
			const shutdown = coordinator.shutdown({ graceful: true, timeoutMs: 25 }).then(() => {
				shutdownSettled = true;
			});

			await vi.advanceTimersByTimeAsync(20);
			releaseRunning?.();
			await run;
			await saveStarted;
			expect(shutdownSettled).toBe(false);

			await vi.advanceTimersByTimeAsync(4);
			expect(shutdownSettled).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await shutdown;

			expect(Date.now() - shutdownStartedAt).toBe(25);
			expect(coordinator.status).toBe('stopped');
		} finally {
			vi.useRealTimers();
		}
	});

	it('bounds a waiting-session flush that never settles', async () => {
		vi.useFakeTimers();
		try {
			const sessionId = 'shutdown-hung-waiting-flush-session' as AgentSessionId;
			const snapshotStore = createMockSnapshotStore(new Map());
			let markSaveStarted: (() => void) | undefined;
			const saveStarted = new Promise<void>((resolve) => {
				markSaveStarted = resolve;
			});
			vi.mocked(snapshotStore.save).mockImplementation(async () => {
				markSaveStarted?.();
				await new Promise<never>(() => {});
			});

			const instance = createMockAgentInstance(sessionId);
			vi.mocked(instance.checkpoint).mockResolvedValue(createSuspendedCheckpoint(sessionId));
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

			let shutdownSettled = false;
			const shutdown = coordinator.shutdown({ graceful: true, timeoutMs: 25 }).then(() => {
				shutdownSettled = true;
			});
			await saveStarted;
			expect(shutdownSettled).toBe(false);

			await vi.advanceTimersByTimeAsync(24);
			expect(shutdownSettled).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await shutdown;

			expect(coordinator.status).toBe('stopped');
			expect(instance.abort).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
