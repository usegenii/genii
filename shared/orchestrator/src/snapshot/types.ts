/**
 * Snapshot system types.
 */

import type { GuidanceCheckpoint, MemoryWrite } from '../guidance/types';
import type { ToolExecutionState } from '../tools/types';
import type { AgentSessionId, PartialAgentMetrics } from '../types/core';

// Re-export for convenience
export type { GuidanceCheckpoint, MemoryWrite, ToolExecutionState };

/**
 * Common checkpoint message format (provider-agnostic).
 * All adapters transform their native message format to/from this format.
 */
export interface CheckpointMessage {
	role: 'user' | 'assistant' | 'tool_result';
	content: CheckpointContent[];
	timestamp: number;
	/** For tool_result messages */
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	/** For assistant messages - provider metadata */
	provider?: string;
	model?: string;
}

/**
 * Content types for checkpoint messages.
 */
export type CheckpointContent =
	| { type: 'text'; text: string }
	| { type: 'image'; mediaType: string; data: string }
	| { type: 'thinking'; text: string }
	| { type: 'tool_use'; id: string; name: string; input: unknown };

/**
 * Adapter-specific configuration stored in checkpoints.
 */
export interface CheckpointAdapterConfig {
	provider: string;
	model: string;
	thinkingLevel?: string;
	[key: string]: unknown;
}

/**
 * Complete checkpoint of an agent's state.
 */
export interface AgentCheckpoint {
	/** When the checkpoint was taken */
	timestamp: number;
	/** Name of the adapter that created this agent */
	adapterName: string;
	/** Session state */
	session: SessionCheckpoint;
	/** Guidance state */
	guidance: GuidanceCheckpoint;
	/** Common message format - all adapters transform to/from this */
	messages: CheckpointMessage[];
	/** Adapter-specific state (model config, thinking level, etc.) */
	adapterConfig: CheckpointAdapterConfig;
	/** State of tool executions */
	toolExecutions: ToolExecutionState[];
}

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
