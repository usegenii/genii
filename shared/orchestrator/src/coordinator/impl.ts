/**
 * Coordinator implementation.
 */

import type { AgentAdapter } from '../adapters/types';
import { TypedEventEmitter } from '../events/emitter';
import type { CoordinatorEvent } from '../events/types';
import { createGuidanceContext } from '../guidance/context';
import { type AgentHandleImpl, createAgentHandle } from '../handle/impl';
import type { AgentHandle } from '../handle/types';
import type {
	AgentFilter,
	AgentSessionId,
	AgentSpawnConfig,
	CoordinatorStatus,
	Disposable,
	ShutdownOptions,
} from '../types/core';
import type { Coordinator, CoordinatorConfig } from './types';

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

	constructor(config: CoordinatorConfig) {
		this.config = config;
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

		const guidance = await createGuidanceContext({ root: guidancePath });

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
					handle
						.checkpoint()
						.then((checkpoint) => {
							this.config.snapshotStore?.save(checkpoint);
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
