/**
 * Coordinator implementation.
 */

import type { AgentAdapter } from '../adapters/types';
import { TypedEventEmitter } from '../events/emitter';
import type { CoordinatorEvent } from '../events/types';
import { createGuidanceContext } from '../guidance/context';
import { type AgentHandleImpl, createAgentHandle } from '../handle/impl';
import type { AgentHandle } from '../handle/types';
import type { AgentCheckpoint } from '../snapshot/types';
import type {
	AgentFilter,
	AgentInput,
	AgentSessionId,
	AgentSpawnConfig,
	CoordinatorStatus,
	Disposable,
	ShutdownOptions,
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

	constructor(config: CoordinatorConfig) {
		this.config = config;
		this.logger = config.logger ?? noopLogger;
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

		// Create guidance context
		const guidancePath = config.guidancePath ?? this.config.defaultGuidancePath;
		if (!guidancePath) {
			throw new Error('No guidance path specified and no default configured');
		}

		this.logger.debug({ guidancePath }, 'Creating guidance context for agent spawn');
		const guidance = await createGuidanceContext({ root: guidancePath, logger: this.logger });

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

		// Restore instance via adapter with new input
		const instance = await adapter.restore(checkpoint, {
			guidance,
			task: checkpoint.session.task,
			input,
			parentId: checkpoint.session.parentId,
			tools: continueConfig?.tools,
			tags: checkpoint.session.tags,
			metadata: checkpoint.session.metadata,
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
