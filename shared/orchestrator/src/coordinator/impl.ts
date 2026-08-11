/**
 * Coordinator implementation.
 */

import type { AdapterCheckpointReason, AgentAdapter, AgentInstance } from '../adapters/types';
import type { ContextInjectorRegistry } from '../context-injectors/registry';
import type { ContextInjection } from '../context-injectors/types';
import { TypedEventEmitter } from '../events/emitter';
import type { CoordinatorEvent, PendingRequestInfo, PendingResolution, SuspensionRequestData } from '../events/types';
import { createGuidanceContext } from '../guidance/context';
import type { GuidanceContext } from '../guidance/types';
import { type AgentHandleImpl, createAgentHandle } from '../handle/impl';
import type { AgentHandle } from '../handle/types';
import { createSkillsLoader } from '../skills/loader';
import type { LoadedSkill } from '../skills/types';
import { type AgentCheckpoint, CHECKPOINT_VERSION, type InstanceCheckpoint } from '../snapshot/types';
import type { SuspensionRequest, ToolExecutionState } from '../tools/types';
import {
	type AgentFilter,
	type AgentInput,
	type AgentSessionId,
	type AgentSpawnConfig,
	type CoordinatorStatus,
	type Disposable,
	generateAgentSessionId,
	type ShutdownOptions,
} from '../types/core';
import { type Logger, noopLogger } from '../types/logger';
import type { ContinueConfig, Coordinator, CoordinatorConfig, SuspensionRestoreConfig } from './types';

/**
 * Tracked agent entry with handle and adapter.
 */
interface TrackedAgent {
	handle: AgentHandleImpl;
	adapter: AgentAdapter;
	checkpointAdmission: CheckpointAdmission;
	unsubscribe: Disposable;
}

interface TrackHandleOptions {
	persistTerminalCheckpoint?: boolean;
	transferTerminalCheckpointOnWaiting?: boolean;
}

interface CheckpointAdmission {
	readonly token: symbol;
	hasCommittedDurableMarker: boolean;
}

interface DurableRestoreHandle {
	handle: AgentHandleImpl;
	checkpointAdmission: CheckpointAdmission;
}

interface InFlightAgentOperation {
	lifecycleEpoch: number;
	kind: 'continue' | 'restore_suspended' | 'resume_batch';
	promise: Promise<AgentHandle>;
}

interface TerminalCheckpointTask {
	promise: Promise<void>;
}

/**
 * Implementation of the Coordinator.
 */
export class CoordinatorImpl implements Coordinator {
	private config: CoordinatorConfig;
	private agents = new Map<AgentSessionId, TrackedAgent>();
	private emitter = new TypedEventEmitter<CoordinatorEvent>();
	private _status: CoordinatorStatus = 'stopped';
	private lifecycleEpoch = 0;
	private logger: Logger;
	private contextInjectorRegistry?: ContextInjectorRegistry;
	private timezone: string;
	private readonly checkpointSaves = new Map<AgentSessionId, Promise<void>>();
	private readonly terminalCheckpointTasks = new Map<AgentSessionId, TerminalCheckpointTask>();
	private readonly sessionOperations = new Map<AgentSessionId, InFlightAgentOperation>();

	constructor(config: CoordinatorConfig) {
		this.config = config;
		this.logger = config.logger ?? noopLogger;
		this.contextInjectorRegistry = config.contextInjectorRegistry;
		// Default to system timezone if not specified
		this.timezone = config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	}

	/**
	 * Collect system context from registered injectors for new sessions.
	 * @param sessionId - The agent session ID
	 * @param guidance - The guidance context
	 * @param skills - Loaded skills
	 * @param metadata - Optional metadata to pass to injectors
	 * @returns System context string, or undefined if no registry/context
	 */
	private async collectSystemContext(
		sessionId: string,
		guidance: GuidanceContext,
		skills: LoadedSkill[],
		metadata?: Record<string, unknown>,
	): Promise<string | undefined> {
		if (!this.contextInjectorRegistry) {
			return undefined;
		}

		const ctx = {
			timezone: this.timezone,
			now: new Date(),
			sessionId,
			guidance,
			skills,
			guidancePath: guidance.root,
			metadata,
		};

		const systemContext = await this.contextInjectorRegistry.collectSystemContext(ctx);

		if (systemContext) {
			this.logger.debug({ sessionId, hasSystemContext: true }, 'Collected system context');
		}

		return systemContext;
	}

	/**
	 * Collect resume context from registered injectors for continued sessions.
	 * @param sessionId - The agent session ID
	 * @param guidance - The guidance context
	 * @param skills - Loaded skills
	 * @returns Context injection with resumeMessages, or undefined if no registry/context
	 */
	private collectResumeContext(
		sessionId: string,
		guidance: GuidanceContext,
		skills: LoadedSkill[],
	): ContextInjection | undefined {
		if (!this.contextInjectorRegistry) {
			return undefined;
		}

		const ctx = {
			timezone: this.timezone,
			now: new Date(),
			sessionId,
			guidance,
			skills,
			guidancePath: guidance.root,
		};

		const resumeMessages = this.contextInjectorRegistry.collectResumeContext(ctx);

		if (resumeMessages && resumeMessages.length > 0) {
			this.logger.debug({ sessionId, resumeMessageCount: resumeMessages.length }, 'Collected resume context');
			return { resumeMessages };
		}

		return undefined;
	}

	/** Persist an adapter checkpoint with coordinator-owned model metadata. */
	private async persistCheckpoint(
		checkpoint: InstanceCheckpoint,
		adapter: AgentAdapter,
		expectedLifecycleEpoch: number | null = this.lifecycleEpoch,
	): Promise<void> {
		const snapshotStore = this.config.snapshotStore;
		if (!snapshotStore) return;
		if (expectedLifecycleEpoch !== null && this.lifecycleEpoch !== expectedLifecycleEpoch) {
			throw new Error('Cannot persist checkpoint: coordinator lifecycle changed');
		}

		const normalizedCheckpoint = this.normalizeCheckpointPhase(checkpoint);
		const enrichedCheckpoint: AgentCheckpoint = structuredClone({
			...normalizedCheckpoint,
			version: CHECKPOINT_VERSION,
			adapterConfig: {
				...normalizedCheckpoint.adapterConfig,
				provider: adapter.modelProvider,
				model: adapter.modelName,
			},
		});
		const sessionId = enrichedCheckpoint.session.id;
		const previousSave = this.checkpointSaves.get(sessionId) ?? Promise.resolve();
		const currentSave = previousSave.catch(() => undefined).then(() => snapshotStore.save(enrichedCheckpoint));

		this.checkpointSaves.set(sessionId, currentSave);

		try {
			await currentSave;
		} finally {
			if (this.checkpointSaves.get(sessionId) === currentSave) {
				this.checkpointSaves.delete(sessionId);
			}
		}
	}

	/** Wait until terminal checkpoint generation and every accepted save before this read have settled. */
	private async waitForCheckpointPersistenceTail(sessionId: AgentSessionId): Promise<void> {
		while (true) {
			const terminalCheckpoint = this.terminalCheckpointTasks.get(sessionId)?.promise;
			const pendingSave = this.checkpointSaves.get(sessionId);
			if (!terminalCheckpoint && !pendingSave) return;
			await Promise.all([terminalCheckpoint?.catch(() => undefined), pendingSave?.catch(() => undefined)]);
		}
	}

	private normalizeCheckpointPhase(checkpoint: InstanceCheckpoint): InstanceCheckpoint {
		const durableBatch =
			checkpoint.toolExecutions.length > 0 &&
			checkpoint.toolExecutions.some((execution) => execution.suspendedStep !== undefined);
		if (durableBatch) {
			const phase = checkpoint.toolExecutions.every((execution) => execution.result !== undefined)
				? 'continuation_pending'
				: 'batch_pending';
			return { ...checkpoint, phase };
		}
		if (checkpoint.phase === undefined) return checkpoint;

		const { phase: _phase, ...completedCheckpoint } = checkpoint;
		return completedCheckpoint;
	}

	private hasDurableMarker(checkpoint: InstanceCheckpoint): boolean {
		return this.normalizeCheckpointPhase(checkpoint).phase !== undefined;
	}

	private isLifecycleCurrent(lifecycleEpoch: number): boolean {
		return this._status === 'running' && this.lifecycleEpoch === lifecycleEpoch;
	}

	private isCheckpointLifecycleCurrent(
		lifecycleEpoch: number,
		sessionId: AgentSessionId,
		checkpointAdmission: CheckpointAdmission,
	): boolean {
		if (this.lifecycleEpoch !== lifecycleEpoch) return false;
		return (
			(this._status === 'running' || this._status === 'stopping') &&
			this.agents.get(sessionId)?.checkpointAdmission === checkpointAdmission
		);
	}

	private assertCreatedInstanceIsCurrent(instance: AgentInstance, lifecycleEpoch: number, operation: string): void {
		if (this.isLifecycleCurrent(lifecycleEpoch)) return;

		try {
			instance.abort();
		} catch (error) {
			this.logger.error(
				{ error, sessionId: instance.id },
				'Failed to abort instance from a stale coordinator lifecycle',
			);
		}
		throw new Error(`Cannot ${operation}: coordinator lifecycle changed`);
	}

	private assertLifecycleIsCurrent(lifecycleEpoch: number, operation: string): void {
		if (!this.isLifecycleCurrent(lifecycleEpoch)) {
			throw new Error(`Cannot ${operation}: coordinator lifecycle changed`);
		}
	}

	private assertCheckpointLifecycleIsCurrent(
		lifecycleEpoch: number,
		sessionId: AgentSessionId,
		checkpointAdmission: CheckpointAdmission,
		operation: string,
	): void {
		if (!this.isCheckpointLifecycleCurrent(lifecycleEpoch, sessionId, checkpointAdmission)) {
			throw new Error(`Cannot ${operation}: coordinator lifecycle changed`);
		}
	}

	/** Wait for checkpoint work already accepted by the coordinator before shutdown returns. */
	private async drainShutdownPersistence(
		deadline: number,
		timeoutMs: number,
		acceptedTasks: Iterable<Promise<unknown>> = [],
	): Promise<void> {
		let additionalTasks = [...acceptedTasks];

		while (true) {
			const pendingTasks = new Set<Promise<unknown>>([
				...additionalTasks,
				...this.checkpointSaves.values(),
				...[...this.terminalCheckpointTasks.values()].map(({ promise }) => promise),
				...[...this.sessionOperations.values()]
					.filter(({ kind }) => kind === 'resume_batch')
					.map(({ promise }) => promise),
			]);
			additionalTasks = [];
			if (pendingTasks.size === 0) return;

			const remainingMs = deadline - Date.now();
			if (remainingMs <= 0) {
				this.logger.warn(
					{ pendingTasks: pendingTasks.size, timeoutMs },
					'Timed out draining checkpoint persistence during coordinator shutdown',
				);
				return;
			}

			let timeout: ReturnType<typeof setTimeout> | undefined;
			const drained = await Promise.race([
				Promise.allSettled(pendingTasks).then(() => true as const),
				new Promise<false>((resolve) => {
					timeout = setTimeout(() => resolve(false), remainingMs);
				}),
			]);
			if (timeout !== undefined) clearTimeout(timeout);

			if (!drained) {
				this.logger.warn(
					{ pendingTasks: pendingTasks.size, timeoutMs },
					'Timed out draining checkpoint persistence during coordinator shutdown',
				);
				return;
			}
		}
	}

	/** Wait for a running handle to complete or become a fully parked waiting batch. */
	private waitForHandleToSettleOrPark(handle: AgentHandleImpl): {
		promise: Promise<'waiting' | 'done'>;
		dispose: Disposable;
	} {
		let dispose: Disposable = () => {};
		let settle: ((outcome: 'waiting' | 'done') => void) | undefined;
		const promise = new Promise<'waiting' | 'done'>((resolve) => {
			let settled = false;
			settle = (outcome) => {
				if (settled) return;
				settled = true;
				dispose();
				resolve(outcome);
			};
		});

		dispose = handle.subscribe((event) => {
			if (event.type === 'done') settle?.('done');
			if (event.type === 'status' && event.status === 'waiting') settle?.('waiting');
		});
		if (handle.status === 'waiting') settle?.('waiting');
		if (handle.status === 'completed' || handle.status === 'failed' || handle.status === 'terminated') {
			settle?.('done');
		}

		return { promise, dispose };
	}

	private untrackHandle(handle: AgentHandleImpl): void {
		const tracked = this.agents.get(handle.id);
		if (tracked?.handle !== handle) return;
		tracked.unsubscribe();
		this.agents.delete(handle.id);
	}

	/** Add a handle to coordinator tracking and forward all of its events. */
	private trackHandle(
		handle: AgentHandleImpl,
		adapter: AgentAdapter,
		checkpointAdmission: CheckpointAdmission,
		options: TrackHandleOptions = {},
	): void {
		this.agents.get(handle.id)?.unsubscribe();
		let persistTerminalCheckpoint = options.persistTerminalCheckpoint ?? true;

		const unsubscribe = handle.subscribe((event) => {
			// A replaced or shutdown-detached handle must not publish events or
			// checkpoints into the lifecycle that now owns the same session ID.
			if (this.agents.get(handle.id)?.handle !== handle) return;

			// A recovered continuation owns its first terminal checkpoint so a
			// failed provider attempt cannot erase its durable marker. Once that
			// continuation fully parks again, ordinary terminal ownership resumes.
			if (event.type === 'status' && event.status === 'waiting' && options.transferTerminalCheckpointOnWaiting) {
				persistTerminalCheckpoint = true;
			}

			this.emitter.emit({
				type: 'agent_event',
				sessionId: handle.id,
				event,
				timestamp: Date.now(),
			});

			if (event.type !== 'done') return;

			this.emitter.emit({
				type: 'agent_done',
				sessionId: handle.id,
				result: event.result,
				timestamp: Date.now(),
			});
			if (event.result.status === 'failed' && checkpointAdmission.hasCommittedDurableMarker) {
				// The durable marker is the restart point for a provider retry. A
				// failed terminal snapshot must not replace it with cleared batch state,
				// and the dead handle must release ownership so retry can restore it.
				this.untrackHandle(handle);
				return;
			}
			if (!persistTerminalCheckpoint) return;

			// Terminal checkpointing is best effort. Suspension and accepted
			// resolution checkpoints use the awaited adapter lifecycle hook.
			const terminalCheckpointPromise = handle
				.checkpoint()
				// The terminal event was admitted while this handle owned the session.
				// Keep that accepted write alive across a bounded shutdown so a later
				// restart can wait for it before loading the session.
				.then(async (checkpoint) => {
					await this.persistCheckpoint(checkpoint, adapter, null);
					const hasDurableMarker = this.hasDurableMarker(checkpoint);
					checkpointAdmission.hasCommittedDurableMarker = hasDurableMarker;
					if (event.result.status === 'failed' && hasDurableMarker) this.untrackHandle(handle);
				})
				.catch((error) => {
					this.logger.error({ error, sessionId: handle.id }, 'Failed to save terminal agent checkpoint');
				});
			const terminalCheckpointTask: TerminalCheckpointTask = {
				promise: terminalCheckpointPromise,
			};
			this.terminalCheckpointTasks.set(handle.id, terminalCheckpointTask);
			void terminalCheckpointPromise.finally(() => {
				if (this.terminalCheckpointTasks.get(handle.id) === terminalCheckpointTask) {
					this.terminalCheckpointTasks.delete(handle.id);
				}
			});
		});
		this.agents.set(handle.id, { handle, adapter, checkpointAdmission, unsubscribe });
	}

	/** Lifecycle callback used by adapters for fail-closed durability barriers. */
	private checkpointHook(
		adapter: AgentAdapter,
		lifecycleEpoch: number,
		checkpointAdmission: CheckpointAdmission,
	): (checkpoint: InstanceCheckpoint, reason: AdapterCheckpointReason) => Promise<void> {
		return async (checkpoint, reason) => {
			if (!this.config.snapshotStore) {
				throw new Error(`Cannot persist ${reason} checkpoint: no snapshot store is configured`);
			}
			this.assertCheckpointLifecycleIsCurrent(
				lifecycleEpoch,
				checkpoint.session.id,
				checkpointAdmission,
				`persist ${reason} checkpoint`,
			);
			await this.persistCheckpoint(checkpoint, adapter, lifecycleEpoch);
			checkpointAdmission.hasCommittedDurableMarker = this.hasDurableMarker(checkpoint);
			this.assertCheckpointLifecycleIsCurrent(
				lifecycleEpoch,
				checkpoint.session.id,
				checkpointAdmission,
				`finish persisting ${reason} checkpoint`,
			);
		};
	}

	private suspensionRequestToData(request: SuspensionRequest): SuspensionRequestData {
		switch (request.type) {
			case 'user_input':
				return {
					type: 'user_input',
					prompt: request.request.prompt,
					schema: request.request.schema,
					timeout: request.request.timeout,
				};
			case 'approval':
				return {
					type: 'approval',
					action: request.request.action,
					description: request.request.description,
					details: request.request.details,
					timeout: request.request.timeout,
				};
			case 'event':
				return {
					type: 'event',
					eventName: request.eventName,
					timeout: request.options?.timeout,
				};
			case 'sleep':
				return {
					type: 'sleep',
					durationMs: request.durationMs,
					wakeAt: request.wakeAt,
				};
		}
	}

	private executionToPendingRequest(execution: ToolExecutionState): PendingRequestInfo | null {
		const suspended = execution.suspendedStep;
		if (!suspended || execution.result) return null;
		return {
			suspensionId: suspended.suspensionId,
			toolCallId: execution.toolCallId,
			toolName: execution.toolName,
			stepId: suspended.stepId,
			type: suspended.request.type,
			request: this.suspensionRequestToData(suspended.request),
			suspendedAt: suspended.suspendedAt,
			deadline: suspended.deadline,
			status: suspended.status,
		};
	}

	get status(): CoordinatorStatus {
		return this._status;
	}

	async start(): Promise<void> {
		if (this._status !== 'stopped') {
			throw new Error(`Cannot start coordinator in state: ${this._status}`);
		}

		this.lifecycleEpoch++;
		this._status = 'starting';

		// Could restore persisted agents here if we have a snapshot store
		// Persisted sessions found - full restore would recreate agents here

		this._status = 'running';
	}

	async shutdown(options: ShutdownOptions = {}): Promise<void> {
		if (this._status !== 'running') {
			throw new Error(`Cannot shutdown coordinator in state: ${this._status}`);
		}

		this._status = 'stopping';

		const { graceful = true, timeoutMs = 30000 } = options;
		const timeoutBudgetMs = Math.max(0, timeoutMs);
		const shutdownDeadline = Date.now() + timeoutBudgetMs;

		if (graceful) {
			// Wait for running agents to complete or reach a fully parked batch.
			const runningAgents = [...this.agents.values()].map((a) => a.handle).filter((h) => h.status === 'running');

			if (runningAgents.length > 0) {
				const waiters = runningAgents.map((handle) => this.waitForHandleToSettleOrPark(handle));
				let timeout: ReturnType<typeof setTimeout> | undefined;
				try {
					const remainingMs = shutdownDeadline - Date.now();
					if (remainingMs > 0) {
						await Promise.race([
							Promise.all(waiters.map((waiter) => waiter.promise)),
							new Promise<void>((resolve) => {
								timeout = setTimeout(resolve, remainingMs);
							}),
						]);
					}
				} finally {
					if (timeout !== undefined) clearTimeout(timeout);
					for (const waiter of waiters) waiter.dispose();
				}
			}
		}

		// Adapters may publish a terminal status immediately before their done
		// event. Keep that small event gap inside the same bounded persistence
		// drain so the terminal checkpoint task can be registered and saved.
		const terminalEventTasks = [...this.agents.values()]
			.map(({ handle }) => handle)
			.filter((handle) => handle.status === 'completed' || handle.status === 'failed')
			.map((handle) => handle.wait());

		// Admission is already closed by the stopping status, but checkpoint
		// callbacks accepted by active instances remain valid through the
		// graceful window. Fence them before detaching or terminating handles.
		this.lifecycleEpoch++;

		// A waiting status now means every unfinished wrapper is parked. Start
		// flushing those checkpoints without letting a stuck store bypass the
		// configured shutdown persistence bound.
		const waitingFlushTasks = [...this.agents.values()]
			.filter(({ handle }) => handle.status === 'waiting')
			.map(({ handle, adapter }) =>
				handle
					.checkpoint()
					.then((checkpoint) => {
						if (this.agents.get(handle.id)?.handle !== handle) return;
						return this.persistCheckpoint(checkpoint, adapter, this.lifecycleEpoch);
					})
					.catch((error) => {
						this.logger.error({ error, sessionId: handle.id }, 'Failed to flush waiting agent checkpoint');
					}),
			);

		// Snapshot termination ownership and invoke every termination before the
		// first await. Otherwise terminating one handle can let a sibling advance
		// into the completed-before-done gap after the terminal wait snapshot.
		const handlesToTerminate = [...this.agents.values()]
			.map(({ handle }) => handle)
			.filter(
				(handle) =>
					handle.status === 'initializing' || handle.status === 'running' || handle.status === 'paused',
			);
		await Promise.all(handlesToTerminate.map((handle) => handle.terminate('Coordinator shutdown')));

		// Termination can start a terminal checkpoint or finish an in-flight
		// continuation recovery that must commit its cleared durable marker.
		await this.drainShutdownPersistence(shutdownDeadline, timeoutBudgetMs, [
			...terminalEventTasks,
			...waitingFlushTasks,
		]);

		for (const tracked of this.agents.values()) tracked.unsubscribe();
		this.agents.clear();
		this._status = 'stopped';
	}

	async spawn(adapter: AgentAdapter, config: AgentSpawnConfig): Promise<AgentHandle> {
		if (this._status !== 'running') {
			throw new Error(`Cannot spawn agent when coordinator is ${this._status}`);
		}
		const lifecycleEpoch = this.lifecycleEpoch;

		// Generate session ID upfront for context injection
		const sessionId = generateAgentSessionId();

		// Create guidance context
		const guidancePath = config.guidancePath ?? this.config.defaultGuidancePath;
		if (!guidancePath) {
			throw new Error('No guidance path specified and no default configured');
		}

		this.logger.debug({ guidancePath }, 'Creating guidance context for agent spawn');
		const guidance = await createGuidanceContext({ root: guidancePath, logger: this.logger });

		// Load skills if skillsPath is configured
		let skills: LoadedSkill[] = [];
		if (this.config.skillsPath) {
			this.logger.debug({ skillsPath: this.config.skillsPath }, 'Loading skills for agent spawn');
			const skillsLoader = createSkillsLoader({
				skillsDir: this.config.skillsPath,
				logger: this.logger,
			});
			skills = await skillsLoader.loadAll();
			this.logger.info(
				{
					skillsPath: this.config.skillsPath,
					skillCount: skills.length,
					skillNames: skills.map((s) => s.name),
				},
				'Skills loaded for agent spawn',
			);
		}

		// Collect system context for new spawn (needs guidance and skills, and metadata for pulse)
		const systemContext = await this.collectSystemContext(sessionId, guidance, skills, config.metadata);
		const contextInjection: ContextInjection | undefined = systemContext ? { systemContext } : undefined;

		// Create instance via adapter
		const checkpointAdmission: CheckpointAdmission = {
			token: Symbol('spawn-checkpoint'),
			hasCommittedDurableMarker: false,
		};
		const instance = await adapter.create({
			guidance,
			task: config.task,
			limits: config.limits,
			input: config.input,
			parentId: config.parentId,
			tools: config.tools,
			tags: config.tags,
			metadata: config.metadata,
			skills,
			contextInjection,
			logger: this.logger,
			onCheckpoint: this.checkpointHook(adapter, lifecycleEpoch, checkpointAdmission),
		});
		this.assertCreatedInstanceIsCurrent(instance, lifecycleEpoch, 'spawn agent');

		// Create handle
		const handle = createAgentHandle(instance, config);

		this.trackHandle(handle, adapter, checkpointAdmission);

		// Emit spawned event
		this.emitter.emit({
			type: 'agent_spawned',
			sessionId: handle.id,
			tags: config.tags,
			parentId: config.parentId,
			timestamp: Date.now(),
		});

		// NOTE: handle.start() is NOT called here. Callers must call it after
		// binding the agent to a destination to avoid the race condition where
		// events fire before the router has bound the agent.

		return handle;
	}

	get(id: AgentSessionId): AgentHandle | undefined {
		return this.agents.get(id)?.handle;
	}

	getAdapter(id: AgentSessionId): AgentAdapter | undefined {
		return this.agents.get(id)?.adapter;
	}

	list(filter?: AgentFilter): AgentHandle[] {
		let results = [...this.agents.values()].map((a) => a.handle);

		if (filter) {
			// Filter by status
			if (filter.status) {
				const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
				results = results.filter((h) => statuses.includes(h.status));
			}

			// Filter by tags (any match)
			if (filter.tags && filter.tags.length > 0) {
				results = results.filter((h) => filter.tags?.some((t) => h.config.tags?.includes(t)));
			}

			// Filter by parent
			if (filter.parentId) {
				results = results.filter((h) => h.config.parentId === filter.parentId);
			}
		}

		return results;
	}

	async listCheckpoints(): Promise<AgentSessionId[]> {
		if (!this.config.snapshotStore) {
			return [];
		}
		return this.config.snapshotStore.list();
	}

	async loadCheckpoint(sessionId: AgentSessionId): Promise<AgentCheckpoint | null> {
		if (!this.config.snapshotStore) {
			return null;
		}
		await this.waitForCheckpointPersistenceTail(sessionId);
		const checkpoint = await this.config.snapshotStore.load(sessionId);
		const version = (checkpoint as { version?: unknown } | null)?.version;
		if (version !== undefined && version !== CHECKPOINT_VERSION) {
			throw new Error(`Unsupported checkpoint version: ${String(version)}`);
		}
		return checkpoint;
	}

	async continue(
		sessionId: AgentSessionId,
		input: AgentInput,
		adapter: AgentAdapter,
		continueConfig?: ContinueConfig,
	): Promise<AgentHandle> {
		if (this._status !== 'running') {
			throw new Error(`Cannot continue agent when coordinator is ${this._status}`);
		}
		const lifecycleEpoch = this.lifecycleEpoch;
		const trackedHandle = this.agents.get(sessionId)?.handle;
		if (trackedHandle && trackedHandle.status !== 'completed') {
			throw new Error(`Session ${sessionId} is already active with status ${trackedHandle.status}`);
		}
		const inFlightOperation = this.sessionOperations.get(sessionId);
		if (inFlightOperation?.lifecycleEpoch === lifecycleEpoch) {
			throw new Error(`Session ${sessionId} already has a continuation in progress`);
		}

		const continuation = this.continueNow(sessionId, input, adapter, lifecycleEpoch, continueConfig);
		const operation: InFlightAgentOperation = { lifecycleEpoch, kind: 'continue', promise: continuation };
		this.sessionOperations.set(sessionId, operation);
		try {
			return await continuation;
		} finally {
			if (this.sessionOperations.get(sessionId) === operation) {
				this.sessionOperations.delete(sessionId);
			}
		}
	}

	private async continueNow(
		sessionId: AgentSessionId,
		input: AgentInput,
		adapter: AgentAdapter,
		lifecycleEpoch: number,
		continueConfig?: ContinueConfig,
	): Promise<AgentHandle> {
		const completedHandle = this.agents.get(sessionId)?.handle;
		if (completedHandle?.status === 'completed') {
			// `status: completed` precedes `done`. Waiting for the terminal event
			// closes the small window before its checkpoint task is registered.
			await completedHandle.wait();
		}
		// Load checkpoint
		const checkpoint = await this.loadCheckpoint(sessionId);
		if (!checkpoint) {
			throw new Error(`Checkpoint not found for session: ${sessionId}`);
		}
		if (checkpoint.phase === 'continuation_pending') {
			throw new Error(`Session ${sessionId} has a pending model continuation`);
		}
		if (checkpoint.phase === 'batch_pending') {
			throw new Error(`Session ${sessionId} has a pending durable tool batch`);
		}
		if (checkpoint.toolExecutions.some((execution) => execution.suspendedStep)) {
			throw new Error(`Session ${sessionId} is waiting for a suspension resolution`);
		}

		// Create guidance context from checkpoint
		const guidancePath = checkpoint.guidance.guidancePath ?? this.config.defaultGuidancePath;
		if (!guidancePath) {
			throw new Error('No guidance path in checkpoint and no default configured');
		}
		this.logger.debug({ guidancePath, sessionId }, 'Restoring guidance context from checkpoint');
		const guidance = await createGuidanceContext({ root: guidancePath, logger: this.logger });

		// Load skills if skillsPath is configured
		let skills: LoadedSkill[] = [];
		if (this.config.skillsPath) {
			this.logger.debug({ skillsPath: this.config.skillsPath, sessionId }, 'Loading skills for session continue');
			const skillsLoader = createSkillsLoader({
				skillsDir: this.config.skillsPath,
				logger: this.logger,
			});
			skills = await skillsLoader.loadAll();
			this.logger.info(
				{
					skillsPath: this.config.skillsPath,
					skillCount: skills.length,
					skillNames: skills.map((s) => s.name),
				},
				'Skills loaded for session continue',
			);
		}

		// Collect resume context for continued session (needs guidance and skills)
		const contextInjection = this.collectResumeContext(sessionId, guidance, skills);

		// Restore instance via adapter with new input
		const checkpointAdmission: CheckpointAdmission = {
			token: Symbol('continue-checkpoint'),
			hasCommittedDurableMarker: false,
		};
		const instance = await adapter.restore(checkpoint, {
			guidance,
			task: checkpoint.session.task,
			input,
			parentId: checkpoint.session.parentId,
			tools: continueConfig?.tools,
			tags: checkpoint.session.tags,
			metadata: checkpoint.session.metadata,
			skills,
			contextInjection,
			logger: this.logger,
			onCheckpoint: this.checkpointHook(adapter, lifecycleEpoch, checkpointAdmission),
		});
		this.assertCreatedInstanceIsCurrent(instance, lifecycleEpoch, `continue session ${sessionId}`);

		// Create handle - reusing the session ID from checkpoint
		const spawnConfig: AgentSpawnConfig = {
			guidancePath,
			task: checkpoint.session.task,
			input,
			parentId: checkpoint.session.parentId,
			tags: checkpoint.session.tags,
			metadata: checkpoint.session.metadata,
		};
		const handle = createAgentHandle(instance, spawnConfig);

		this.trackHandle(handle, adapter, checkpointAdmission);

		// Emit continued event (using spawned event type for now)
		this.emitter.emit({
			type: 'agent_spawned',
			sessionId: handle.id,
			tags: spawnConfig.tags,
			parentId: spawnConfig.parentId,
			timestamp: Date.now(),
		});

		// NOTE: handle.start() is NOT called here. Callers must call it after
		// binding the agent to a destination to avoid the race condition where
		// events fire before the router has bound the agent.

		return handle;
	}

	async resumeContinuation(
		sessionId: AgentSessionId,
		adapter: AgentAdapter,
		config?: SuspensionRestoreConfig,
	): Promise<AgentHandle> {
		if (this._status !== 'running') {
			throw new Error(`Cannot resume continuation when coordinator is ${this._status}`);
		}
		const lifecycleEpoch = this.lifecycleEpoch;
		const inFlightOperation = this.sessionOperations.get(sessionId);
		if (inFlightOperation?.lifecycleEpoch === lifecycleEpoch) {
			if (inFlightOperation.kind === 'resume_batch') return inFlightOperation.promise;
			throw new Error(`Session ${sessionId} already has a recovery operation in progress`);
		}

		const resume = this.resumeContinuationNow(sessionId, adapter, lifecycleEpoch, config);
		const operation: InFlightAgentOperation = { lifecycleEpoch, kind: 'resume_batch', promise: resume };
		this.sessionOperations.set(sessionId, operation);
		try {
			return await resume;
		} finally {
			if (this.sessionOperations.get(sessionId) === operation) {
				this.sessionOperations.delete(sessionId);
			}
		}
	}

	private async resumeContinuationNow(
		sessionId: AgentSessionId,
		adapter: AgentAdapter,
		lifecycleEpoch: number,
		config?: SuspensionRestoreConfig,
	): Promise<AgentHandle> {
		if (this.agents.has(sessionId)) {
			throw new Error(`Session ${sessionId} is already restored`);
		}

		const checkpoint = await this.loadCheckpoint(sessionId);
		if (!checkpoint) {
			throw new Error(`Checkpoint not found for session: ${sessionId}`);
		}
		const hasDurableBatch =
			checkpoint.toolExecutions.length > 0 &&
			checkpoint.toolExecutions.some((execution) => execution.suspendedStep !== undefined);
		const recoveryPhase =
			checkpoint.phase ??
			(hasDurableBatch
				? checkpoint.toolExecutions.every((execution) => execution.result !== undefined)
					? 'continuation_pending'
					: 'batch_pending'
				: undefined);
		if (recoveryPhase === undefined) {
			throw new Error(`Session ${sessionId} has no pending model continuation`);
		}
		const replayableBatch =
			hasDurableBatch &&
			(recoveryPhase === 'continuation_pending'
				? checkpoint.toolExecutions.every((execution) => execution.result !== undefined)
				: checkpoint.toolExecutions.every(
						(execution) =>
							execution.suspendedStep === undefined ||
							execution.result !== undefined ||
							(execution.suspendedStep.status === 'resolved' &&
								execution.suspendedStep.resolution !== undefined &&
								execution.suspendedStep.resumeData !== undefined),
					));
		if (!replayableBatch) {
			throw new Error(`Session ${sessionId} has an invalid continuation checkpoint`);
		}

		const { handle, checkpointAdmission } = await this.createDurableRestoreHandle(
			checkpoint,
			adapter,
			lifecycleEpoch,
			config,
		);
		let continuationStarted = false;
		try {
			if (!this.isLifecycleCurrent(lifecycleEpoch)) {
				await handle.terminate('Coordinator lifecycle changed before continuation recovery started');
				throw new Error(`Cannot resume continuation for session ${sessionId}: coordinator lifecycle changed`);
			}
			this.trackDurableRestoreHandle(handle, adapter, checkpointAdmission, true);
			continuationStarted = true;
			const parkedOrDone = this.waitForHandleToSettleOrPark(handle);
			const start = handle.start();
			let outcome: 'waiting' | 'done' | 'iterator_finished';
			try {
				outcome = await Promise.race([parkedOrDone.promise, start.then(() => 'iterator_finished' as const)]);
			} finally {
				parkedOrDone.dispose();
			}

			// The lifecycle checkpoint hook commits the new suspension before the
			// waiting event is published. Return the warm handle at that boundary;
			// its next resolution continues the same iterator and owns terminal
			// checkpointing through the waiting ownership transfer above.
			if (outcome === 'waiting') return handle;

			await start;
			if (handle.status !== 'completed') {
				throw new Error(`Session ${sessionId} continuation ended with status ${handle.status}`);
			}

			const completedCheckpoint = await handle.checkpoint();
			if (completedCheckpoint.toolExecutions.length > 0) {
				throw new Error(`Session ${sessionId} continuation did not clear its durable batch`);
			}
			const persistenceEpoch =
				this.agents.get(sessionId)?.handle === handle ? this.lifecycleEpoch : lifecycleEpoch;
			await this.persistCheckpoint(completedCheckpoint, adapter, persistenceEpoch);
			return handle;
		} catch (error) {
			if (!continuationStarted && !this.isLifecycleCurrent(lifecycleEpoch)) throw error;
			const ownsHandle = this.agents.get(sessionId)?.handle === handle;
			const persistenceEpoch = ownsHandle ? this.lifecycleEpoch : lifecycleEpoch;
			if (ownsHandle) {
				this.agents.get(sessionId)?.unsubscribe();
				this.agents.delete(sessionId);
			}
			// A non-terminal recovery failure must leave the store untouched: the
			// latest successful lifecycle barrier may be newer than the checkpoint
			// that originally triggered recovery. Explicit termination is different;
			// it owns the cleared checkpoint produced by aborting the active replay.
			if (handle.status === 'terminated' && continuationStarted) {
				await this.persistCheckpoint(await handle.checkpoint(), adapter, persistenceEpoch);
			}
			throw error;
		}
	}

	async getPendingRequests(sessionId: AgentSessionId): Promise<PendingRequestInfo[]> {
		const live = this.agents.get(sessionId)?.handle;
		if (live) {
			return live.getPendingRequests();
		}

		const checkpoint = await this.loadCheckpoint(sessionId);
		if (!checkpoint) return [];

		return checkpoint.toolExecutions
			.map((execution) => this.executionToPendingRequest(execution))
			.filter((request): request is PendingRequestInfo => request !== null);
	}

	async restoreSuspended(
		sessionId: AgentSessionId,
		adapter: AgentAdapter,
		config?: SuspensionRestoreConfig,
	): Promise<AgentHandle> {
		if (this._status !== 'running') {
			throw new Error(`Cannot restore suspended agent when coordinator is ${this._status}`);
		}
		const lifecycleEpoch = this.lifecycleEpoch;
		const live = this.agents.get(sessionId)?.handle;
		if (live) {
			if (live.getPendingRequests().length === 0) {
				throw new Error(`Session ${sessionId} has no pending suspensions`);
			}
			return live;
		}
		const inFlightOperation = this.sessionOperations.get(sessionId);
		if (inFlightOperation?.lifecycleEpoch === lifecycleEpoch) {
			if (inFlightOperation.kind === 'restore_suspended') return inFlightOperation.promise;
			throw new Error(`Session ${sessionId} already has a recovery operation in progress`);
		}

		const restore = this.restoreSuspendedNow(sessionId, adapter, lifecycleEpoch, config);
		const operation: InFlightAgentOperation = { lifecycleEpoch, kind: 'restore_suspended', promise: restore };
		this.sessionOperations.set(sessionId, operation);
		try {
			return await restore;
		} finally {
			if (this.sessionOperations.get(sessionId) === operation) {
				this.sessionOperations.delete(sessionId);
			}
		}
	}

	private async restoreSuspendedNow(
		sessionId: AgentSessionId,
		adapter: AgentAdapter,
		lifecycleEpoch: number,
		config?: SuspensionRestoreConfig,
	): Promise<AgentHandle> {
		const live = this.agents.get(sessionId)?.handle;
		if (live) {
			if (live.getPendingRequests().length === 0) {
				throw new Error(`Session ${sessionId} has no pending suspensions`);
			}
			return live;
		}

		const checkpoint = await this.loadCheckpoint(sessionId);
		if (!checkpoint) {
			throw new Error(`Checkpoint not found for session: ${sessionId}`);
		}
		if (
			checkpoint.phase === 'continuation_pending' ||
			!checkpoint.toolExecutions.some(
				(execution) => execution.suspendedStep !== undefined && execution.result === undefined,
			)
		) {
			throw new Error(`Session ${sessionId} has no pending suspensions`);
		}

		const { handle, checkpointAdmission } = await this.createDurableRestoreHandle(
			checkpoint,
			adapter,
			lifecycleEpoch,
			config,
		);
		if (!this.isLifecycleCurrent(lifecycleEpoch)) {
			await handle.terminate('Coordinator lifecycle changed before suspended session restoration completed');
			throw new Error(`Cannot restore suspended session ${sessionId}: coordinator lifecycle changed`);
		}
		this.trackDurableRestoreHandle(handle, adapter, checkpointAdmission);
		return handle;
	}

	private async createDurableRestoreHandle(
		checkpoint: AgentCheckpoint,
		adapter: AgentAdapter,
		lifecycleEpoch: number,
		config?: SuspensionRestoreConfig,
	): Promise<DurableRestoreHandle> {
		const guidancePath = checkpoint.guidance.guidancePath ?? this.config.defaultGuidancePath;
		if (!guidancePath) {
			throw new Error('No guidance path in checkpoint and no default configured');
		}
		const guidance = await createGuidanceContext({ root: guidancePath, logger: this.logger });

		let skills: LoadedSkill[] = [];
		if (this.config.skillsPath) {
			const skillsLoader = createSkillsLoader({
				skillsDir: this.config.skillsPath,
				logger: this.logger,
			});
			skills = await skillsLoader.loadAll();
		}

		// Deliberately omit input and resume context. This restores the exact
		// suspended tool invocation without manufacturing a user turn.
		const checkpointAdmission: CheckpointAdmission = {
			token: Symbol('durable-restore-checkpoint'),
			hasCommittedDurableMarker: this.hasDurableMarker(checkpoint),
		};
		const instance = await adapter.restore(checkpoint, {
			guidance,
			task: checkpoint.session.task,
			parentId: checkpoint.session.parentId,
			tools: config?.tools,
			tags: checkpoint.session.tags,
			metadata: checkpoint.session.metadata,
			skills,
			logger: this.logger,
			onCheckpoint: this.checkpointHook(adapter, lifecycleEpoch, checkpointAdmission),
		});
		this.assertCreatedInstanceIsCurrent(instance, lifecycleEpoch, `restore session ${checkpoint.session.id}`);

		const spawnConfig: AgentSpawnConfig = {
			guidancePath,
			task: checkpoint.session.task,
			parentId: checkpoint.session.parentId,
			tags: checkpoint.session.tags,
			metadata: checkpoint.session.metadata,
		};
		return { handle: createAgentHandle(instance, spawnConfig), checkpointAdmission };
	}

	private trackDurableRestoreHandle(
		handle: AgentHandleImpl,
		adapter: AgentAdapter,
		checkpointAdmission: CheckpointAdmission,
		continuationRecovery = false,
	): void {
		this.trackHandle(handle, adapter, checkpointAdmission, {
			persistTerminalCheckpoint: !continuationRecovery,
			transferTerminalCheckpointOnWaiting: continuationRecovery,
		});

		this.emitter.emit({
			type: 'agent_spawned',
			sessionId: handle.id,
			tags: handle.config.tags,
			parentId: handle.config.parentId,
			timestamp: Date.now(),
		});
	}

	async resolveSuspensions(
		sessionId: AgentSessionId,
		resolutions: PendingResolution[],
		adapter: AgentAdapter,
		config?: SuspensionRestoreConfig,
	): Promise<AgentHandle> {
		if (resolutions.length === 0) {
			throw new Error('At least one suspension resolution is required');
		}
		if (this._status !== 'running') {
			throw new Error(`Cannot resolve suspensions when coordinator is ${this._status}`);
		}
		const lifecycleEpoch = this.lifecycleEpoch;

		const handle = await this.restoreSuspended(sessionId, adapter, config);
		this.assertLifecycleIsCurrent(lifecycleEpoch, `resolve suspensions for session ${sessionId}`);
		await handle.resolve(resolutions);
		this.assertLifecycleIsCurrent(lifecycleEpoch, `start resolved session ${sessionId}`);

		// A warm handle is already inside start(); a dormant handle begins the
		// replay loop here. Duplicate start calls are suppressed by AgentHandle.
		void handle.start();
		return handle;
	}

	subscribe(handler: (event: CoordinatorEvent) => void): Disposable {
		return this.emitter.on(handler);
	}
}

/**
 * Create a coordinator.
 */
export function createCoordinator(config: CoordinatorConfig): Coordinator {
	return new CoordinatorImpl(config);
}
