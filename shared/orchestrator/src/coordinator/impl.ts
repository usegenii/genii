/**
 * Coordinator implementation.
 */

import type { AgentAdapter } from '../adapters/types';
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
}

/**
 * Implementation of the Coordinator.
 */
export class CoordinatorImpl implements Coordinator {
	private config: CoordinatorConfig;
	private agents = new Map<AgentSessionId, TrackedAgent>();
	private emitter = new TypedEventEmitter<CoordinatorEvent>();
	private _status: CoordinatorStatus = 'stopped';
	private logger: Logger;
	private contextInjectorRegistry?: ContextInjectorRegistry;
	private timezone: string;

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
	private async persistCheckpoint(checkpoint: InstanceCheckpoint, adapter: AgentAdapter): Promise<void> {
		if (!this.config.snapshotStore) return;

		const enrichedCheckpoint: AgentCheckpoint = {
			...checkpoint,
			version: CHECKPOINT_VERSION,
			adapterConfig: {
				...checkpoint.adapterConfig,
				provider: adapter.modelProvider,
				model: adapter.modelName,
			},
		};
		await this.config.snapshotStore.save(enrichedCheckpoint);
	}

	/** Add a handle to coordinator tracking and forward all of its events. */
	private trackHandle(handle: AgentHandleImpl, adapter: AgentAdapter): void {
		this.agents.set(handle.id, { handle, adapter });

		handle.subscribe((event) => {
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

			// Terminal checkpointing is best effort. Suspension and accepted
			// resolution checkpoints use the awaited adapter lifecycle hook.
			void handle
				.checkpoint()
				.then((checkpoint) => this.persistCheckpoint(checkpoint, adapter))
				.catch((error) => {
					this.logger.error({ error, sessionId: handle.id }, 'Failed to save terminal agent checkpoint');
				});
		});
	}

	/** Lifecycle callback used by adapters for fail-closed durability barriers. */
	private checkpointHook(adapter: AgentAdapter): (checkpoint: InstanceCheckpoint, reason: string) => Promise<void> {
		return async (checkpoint, reason) => {
			if (!this.config.snapshotStore) {
				throw new Error(`Cannot persist ${reason} checkpoint: no snapshot store is configured`);
			}
			await this.persistCheckpoint(checkpoint, adapter);
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
		if (!suspended) return null;
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

		// Waiting instances are already dormant. Flush their current checkpoint
		// and detach them immediately; aborting would overwrite durable waiting
		// state with a terminated result.
		for (const { handle, adapter } of this.agents.values()) {
			if (handle.status === 'waiting') {
				await this.persistCheckpoint(await handle.checkpoint(), adapter);
			}
		}

		if (graceful) {
			// Wait for running agents to complete
			const runningAgents = [...this.agents.values()].map((a) => a.handle).filter((h) => h.status === 'running');

			if (runningAgents.length > 0) {
				const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
				const waitAll = Promise.all(runningAgents.map((h) => h.wait()));

				await Promise.race([waitAll, timeout]);
			}
		}

		// Terminate any remaining agents
		for (const { handle } of this.agents.values()) {
			if (handle.status === 'running' || handle.status === 'paused') {
				await handle.terminate('Coordinator shutdown');
			}
		}

		this.agents.clear();
		this._status = 'stopped';
	}

	async spawn(adapter: AgentAdapter, config: AgentSpawnConfig): Promise<AgentHandle> {
		if (this._status !== 'running') {
			throw new Error(`Cannot spawn agent when coordinator is ${this._status}`);
		}

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
			onCheckpoint: this.checkpointHook(adapter),
		});

		// Create handle
		const handle = createAgentHandle(instance, config);

		this.trackHandle(handle, adapter);

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

		// Load checkpoint
		const checkpoint = await this.loadCheckpoint(sessionId);
		if (!checkpoint) {
			throw new Error(`Checkpoint not found for session: ${sessionId}`);
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
			onCheckpoint: this.checkpointHook(adapter),
		});

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

		this.trackHandle(handle, adapter);

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
		if (!checkpoint.toolExecutions.some((execution) => execution.suspendedStep)) {
			throw new Error(`Session ${sessionId} has no pending suspensions`);
		}

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
		const instance = await adapter.restore(checkpoint, {
			guidance,
			task: checkpoint.session.task,
			parentId: checkpoint.session.parentId,
			tools: config?.tools,
			tags: checkpoint.session.tags,
			metadata: checkpoint.session.metadata,
			skills,
			logger: this.logger,
			onCheckpoint: this.checkpointHook(adapter),
		});

		const spawnConfig: AgentSpawnConfig = {
			guidancePath,
			task: checkpoint.session.task,
			parentId: checkpoint.session.parentId,
			tags: checkpoint.session.tags,
			metadata: checkpoint.session.metadata,
		};
		const handle = createAgentHandle(instance, spawnConfig);
		this.trackHandle(handle, adapter);

		this.emitter.emit({
			type: 'agent_spawned',
			sessionId: handle.id,
			tags: spawnConfig.tags,
			parentId: spawnConfig.parentId,
			timestamp: Date.now(),
		});

		return handle;
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

		const handle = await this.restoreSuspended(sessionId, adapter, config);
		await handle.resolve(resolutions);

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
