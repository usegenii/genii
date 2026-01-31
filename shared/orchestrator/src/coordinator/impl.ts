/**
 * Coordinator implementation.
 */

import type { AgentAdapter } from '../adapters/types';
import type { ContextInjectorRegistry } from '../context-injectors/registry';
import type { ContextInjection } from '../context-injectors/types';
import { TypedEventEmitter } from '../events/emitter';
import type { CoordinatorEvent } from '../events/types';
import { createGuidanceContext } from '../guidance/context';
import type { GuidanceContext } from '../guidance/types';
import { type AgentHandleImpl, createAgentHandle } from '../handle/impl';
import type { AgentHandle } from '../handle/types';
import { createSkillsLoader } from '../skills/loader';
import type { LoadedSkill } from '../skills/types';
import type { AgentCheckpoint } from '../snapshot/types';
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
import type { ContinueConfig, Coordinator, CoordinatorConfig } from './types';

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

		if (graceful) {
			// Wait for running agents to complete
			const runningAgents = [...this.agents.values()]
				.map((a) => a.handle)
				.filter((h) => h.status === 'running' || h.status === 'waiting');

			if (runningAgents.length > 0) {
				const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
				const waitAll = Promise.all(runningAgents.map((h) => h.wait()));

				await Promise.race([waitAll, timeout]);
			}
		}

		// Terminate any remaining agents
		for (const { handle } of this.agents.values()) {
			if (handle.status === 'running' || handle.status === 'waiting' || handle.status === 'paused') {
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
		});

		// Create handle
		const handle = createAgentHandle(instance, config);

		// Store handle and adapter
		this.agents.set(handle.id, { handle, adapter });

		// Subscribe to agent events
		handle.subscribe((event) => {
			this.emitter.emit({
				type: 'agent_event',
				sessionId: handle.id,
				event,
				timestamp: Date.now(),
			});

			// Handle completion
			if (event.type === 'done') {
				this.emitter.emit({
					type: 'agent_done',
					sessionId: handle.id,
					result: event.result,
					timestamp: Date.now(),
				});

				// Save checkpoint if we have a store
				if (this.config.snapshotStore) {
					const agentEntry = this.agents.get(handle.id);
					handle
						.checkpoint()
						.then((checkpoint) => {
							// Inject Geniigotchi provider/model from adapter into checkpoint
							const enrichedCheckpoint: AgentCheckpoint = {
								...checkpoint,
								adapterConfig: {
									...checkpoint.adapterConfig,
									provider: agentEntry?.adapter.modelProvider ?? 'unknown',
									model: agentEntry?.adapter.modelName ?? 'unknown',
								},
							};
							this.config.snapshotStore?.save(enrichedCheckpoint);
						})
						.catch((_error) => {
							// Checkpoint save failed - non-fatal, agent completed successfully
						});
				}
			}
		});

		// Emit spawned event
		this.emitter.emit({
			type: 'agent_spawned',
			sessionId: handle.id,
			tags: config.tags,
			parentId: config.parentId,
			timestamp: Date.now(),
		});

		// Start the agent
		handle.start();

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
		return this.config.snapshotStore.load(sessionId);
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

		// Store handle and adapter
		this.agents.set(handle.id, { handle, adapter });

		// Subscribe to agent events (same as spawn)
		handle.subscribe((event) => {
			this.emitter.emit({
				type: 'agent_event',
				sessionId: handle.id,
				event,
				timestamp: Date.now(),
			});

			// Handle completion
			if (event.type === 'done') {
				this.emitter.emit({
					type: 'agent_done',
					sessionId: handle.id,
					result: event.result,
					timestamp: Date.now(),
				});

				// Save checkpoint if we have a store (overwrites previous)
				if (this.config.snapshotStore) {
					const agentEntry = this.agents.get(handle.id);
					handle
						.checkpoint()
						.then((checkpoint) => {
							// Inject Geniigotchi provider/model from adapter into checkpoint
							const enrichedCheckpoint: AgentCheckpoint = {
								...checkpoint,
								adapterConfig: {
									...checkpoint.adapterConfig,
									provider: agentEntry?.adapter.modelProvider ?? 'unknown',
									model: agentEntry?.adapter.modelName ?? 'unknown',
								},
							};
							this.config.snapshotStore?.save(enrichedCheckpoint);
						})
						.catch((_error) => {
							// Checkpoint save failed - non-fatal
						});
				}
			}
		});

		// Emit continued event (using spawned event type for now)
		this.emitter.emit({
			type: 'agent_spawned',
			sessionId: handle.id,
			tags: spawnConfig.tags,
			parentId: spawnConfig.parentId,
			timestamp: Date.now(),
		});

		// Start the agent
		handle.start();

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
