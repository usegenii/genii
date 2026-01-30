/**
 * Coordinator types.
 */

import type { AgentAdapter } from '../adapters/types.js';
import type { CoordinatorEvent } from '../events/types.js';
import type { AgentHandle } from '../handle/types.js';
import type { SnapshotStore } from '../snapshot/types.js';
import type {
	AgentFilter,
	AgentSessionId,
	AgentSpawnConfig,
	CoordinatorStatus,
	Disposable,
	ShutdownOptions,
} from '../types/core.js';

/**
 * Coordinator interface.
 */
export interface Coordinator {
	/**
	 * Start the coordinator.
	 */
	start(): Promise<void>;

	/**
	 * Shutdown the coordinator.
	 */
	shutdown(options?: ShutdownOptions): Promise<void>;

	/**
	 * Spawn a new agent with the specified adapter.
	 */
	spawn(adapter: AgentAdapter, config: AgentSpawnConfig): Promise<AgentHandle>;

	/**
	 * Get an agent by session ID.
	 */
	get(id: AgentSessionId): AgentHandle | undefined;

	/**
	 * Get the adapter used to create an agent.
	 */
	getAdapter(id: AgentSessionId): AgentAdapter | undefined;

	/**
	 * List agents matching a filter.
	 */
	list(filter?: AgentFilter): AgentHandle[];

	/**
	 * Subscribe to coordinator events.
	 */
	subscribe(handler: (event: CoordinatorEvent) => void): Disposable;

	/**
	 * Get the coordinator status.
	 */
	readonly status: CoordinatorStatus;
}

/**
 * Configuration for the coordinator.
 */
export interface CoordinatorConfig {
	/** Snapshot store for persistence (optional) */
	snapshotStore?: SnapshotStore;
	/** Default guidance path if not specified in spawn config */
	defaultGuidancePath?: string;
}
