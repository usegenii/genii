/**
 * Adapter system types.
 */

import type { AgentEvent, PendingRequestInfo, PendingResolution } from '../events/types';
import type { GuidanceContext } from '../guidance/types';
import type { AgentCheckpoint } from '../snapshot/types';
import type { ToolRegistryInterface } from '../tools/types';
import type { AgentInput, AgentLimits, AgentSessionId } from '../types/core';

/**
 * Adapter for creating and restoring agent instances.
 */
export interface AgentAdapter {
	/** Name of this adapter */
	readonly name: string;

	/** Geniigotchi provider name (for checkpointing) */
	readonly modelProvider: string;

	/** Geniigotchi model name/ID (for checkpointing) */
	readonly modelName: string;

	/**
	 * Create a new agent instance.
	 */
	create(config: AdapterCreateConfig): Promise<AgentInstance>;

	/**
	 * Restore an agent instance from a checkpoint.
	 * @param checkpoint - The checkpoint to restore from
	 * @param config - Configuration for the restored agent (guidance, tools, etc.)
	 */
	restore(checkpoint: AgentCheckpoint, config: AdapterCreateConfig): Promise<AgentInstance>;
}

/**
 * Configuration for creating a new agent instance.
 */
export interface AdapterCreateConfig {
	/** Guidance context for accessing SOUL, instructions, etc. */
	guidance: GuidanceContext;
	/** Task ID to load (optional) */
	task?: string | undefined;
	/** Execution limits */
	limits?: AgentLimits | undefined;
	/** Initial input to the agent */
	input?: AgentInput | undefined;
	/** Parent session ID if this is a child agent */
	parentId?: AgentSessionId | undefined;
	/** Tools available to the agent (optional) */
	tools?: ToolRegistryInterface;
	/** Tags for filtering */
	tags?: string[] | undefined;
	/** Arbitrary metadata */
	metadata?: Record<string, unknown> | undefined;
}

/**
 * Status of an agent instance.
 */
export type AgentInstanceStatus = 'idle' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed' | 'aborted';

/**
 * Running agent instance.
 */
export interface AgentInstance {
	/** Unique ID for this instance */
	readonly id: string;

	/**
	 * Run the agent and yield events.
	 */
	run(): AsyncIterable<AgentEvent>;

	/**
	 * Send additional input to the agent.
	 */
	send(input: AgentInput): void;

	/**
	 * Pause the agent.
	 */
	pause(): Promise<void>;

	/**
	 * Resume the agent.
	 */
	resume(): Promise<void>;

	/**
	 * Abort the agent.
	 */
	abort(): void;

	/**
	 * Create a checkpoint of the current state.
	 */
	checkpoint(): Promise<AgentCheckpoint>;

	/**
	 * Get the current status.
	 */
	status(): AgentInstanceStatus;

	/**
	 * Get pending suspension requests.
	 */
	getPendingRequests(): PendingRequestInfo[];

	/**
	 * Resolve pending suspension requests.
	 */
	resolve(resolutions: PendingResolution[]): void;
}
