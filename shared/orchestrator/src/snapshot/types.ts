/**
 * Snapshot system types.
 */

import type { GuidanceCheckpoint, MemoryWrite } from '../guidance/types';
import type { ToolExecutionState } from '../tools/types';
import type { AgentSessionId, PartialAgentMetrics } from '../types/core';

// Re-export for convenience
export type { GuidanceCheckpoint, MemoryWrite, ToolExecutionState };

/**
 * Complete checkpoint of an agent's state.
 */
export interface AgentCheckpoint {
	/** Checkpoint format version */
	version: number;
	/** When the checkpoint was taken */
	timestamp: number;
	/** Name of the adapter that created this agent */
	adapterName: string;
	/** Session state */
	session: SessionCheckpoint;
	/** Guidance state */
	guidance: GuidanceCheckpoint;
	/** Adapter-specific state (e.g., Pi message history) */
	adapterState: unknown;
	/** State of tool executions */
	toolExecutions: ToolExecutionState[];
}

/**
 * Current checkpoint format version.
 */
export const CHECKPOINT_VERSION = 1;

/**
 * Session state for checkpointing.
 */
export interface SessionCheckpoint {
	/** Session ID */
	id: AgentSessionId;
	/** Parent session ID if this is a child agent */
	parentId?: AgentSessionId | undefined;
	/** When the session was created */
	createdAt: number;
	/** Tags for filtering */
	tags: string[];
	/** Arbitrary metadata */
	metadata: Record<string, unknown>;
	/** Task ID if loaded */
	task?: string | undefined;
	/** Partial metrics at checkpoint time */
	metrics: PartialAgentMetrics;
}

/**
 * Storage interface for checkpoints.
 */
export interface SnapshotStore {
	/**
	 * Save a checkpoint.
	 */
	save(checkpoint: AgentCheckpoint): Promise<void>;

	/**
	 * Load a checkpoint by session ID.
	 */
	load(sessionId: AgentSessionId): Promise<AgentCheckpoint | null>;

	/**
	 * Delete a checkpoint.
	 */
	delete(sessionId: AgentSessionId): Promise<boolean>;

	/**
	 * List all checkpoint session IDs.
	 */
	list(): Promise<AgentSessionId[]>;

	/**
	 * Check if a checkpoint exists.
	 */
	exists(sessionId: AgentSessionId): Promise<boolean>;
}

/**
 * Options for creating a file snapshot store.
 */
export interface FileSnapshotStoreOptions {
	/** Directory to store checkpoints */
	directory: string;
}
