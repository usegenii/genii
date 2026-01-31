/**
 * Coordinator types.
 */

import type { AgentAdapter } from '../adapters/types';
import type { CoordinatorEvent } from '../events/types';
import type { AgentHandle } from '../handle/types';
import type { AgentCheckpoint, SnapshotStore } from '../snapshot/types';
import type { ToolRegistryInterface } from '../tools/types';
import type {
	AgentFilter,
	AgentInput,
	AgentSessionId,
	AgentSpawnConfig,
	CoordinatorStatus,
	Disposable,
	ShutdownOptions,
} from '../types/core';
import type { Logger } from '../types/logger';

/**
 * Configuration for continuing a session.
 */
export interface ContinueConfig {
	/** Tools available to the agent */
	tools?: ToolRegistryInterface;
}

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
	 * Continue a session from a checkpoint.
	 * Restores the agent with its message history and queues new input.
	 *
	 * @param sessionId - The session ID to continue
	 * @param input - New input to send to the agent
	 * @param adapter - The adapter to use (may be different from original)
	 * @param config - Optional configuration (tools, etc.)
	 * @returns A handle to the continued agent
	 */
	continue(
		sessionId: AgentSessionId,
		input: AgentInput,
		adapter: AgentAdapter,
		config?: ContinueConfig,
	): Promise<AgentHandle>;

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
	 * List available checkpoint session IDs.
	 */
	listCheckpoints(): Promise<AgentSessionId[]>;

	/**
	 * Load a checkpoint by session ID.
	 */
	loadCheckpoint(sessionId: AgentSessionId): Promise<AgentCheckpoint | null>;

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
	/** Logger for coordinator events */
	logger?: Logger;
}
