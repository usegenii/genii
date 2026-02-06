/**
 * Agent handle type definitions.
 */

import type { AgentEvent, PendingRequestInfo, PendingResolution } from '../events/types';
import type {
	AgentInput,
	AgentResult,
	AgentSessionId,
	AgentSnapshot,
	AgentSpawnConfig,
	AgentStatus,
	Disposable,
} from '../types/core';

/**
 * Handle for interacting with a running agent.
 */
export interface AgentHandle {
	/** Unique session ID */
	readonly id: AgentSessionId;
	/** Current status */
	readonly status: AgentStatus;
	/** Configuration used to spawn the agent */
	readonly config: AgentSpawnConfig;
	/** When the agent was created */
	readonly createdAt: Date;

	/**
	 * Start the agent execution loop.
	 * Call this after binding the agent to its destination to avoid race conditions.
	 */
	start(): void;

	/**
	 * Subscribe to agent events.
	 */
	subscribe(handler: (event: AgentEvent) => void): Disposable;

	/**
	 * Get an async iterable of events.
	 */
	events(): AsyncIterable<AgentEvent>;

	/**
	 * Send additional input to the agent.
	 */
	send(input: AgentInput): Promise<void>;

	/**
	 * Pause the agent.
	 */
	pause(): Promise<void>;

	/**
	 * Resume the agent.
	 */
	resume(): Promise<void>;

	/**
	 * Terminate the agent.
	 */
	terminate(reason?: string): Promise<void>;

	/**
	 * Wait for the agent to complete.
	 */
	wait(): Promise<AgentResult>;

	/**
	 * Get a snapshot of the current state.
	 */
	snapshot(): AgentSnapshot;

	/**
	 * Get pending suspension requests.
	 */
	getPendingRequests(): PendingRequestInfo[];

	/**
	 * Resolve pending suspension requests.
	 */
	resolve(resolutions: PendingResolution[]): Promise<void>;
}
