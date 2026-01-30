/**
 * Core types for the orchestrator system.
 */

import type { ToolRegistryInterface } from '../tools/types.js';

/**
 * Branded type for agent session IDs.
 */
export type AgentSessionId = string & { readonly __brand: 'AgentSessionId' };

/**
 * Create an AgentSessionId from a string.
 */
export function createAgentSessionId(id: string): AgentSessionId {
	return id as AgentSessionId;
}

/**
 * Generate a new unique AgentSessionId.
 */
export function generateAgentSessionId(): AgentSessionId {
	return crypto.randomUUID() as AgentSessionId;
}

/**
 * Status of an agent throughout its lifecycle.
 */
export type AgentStatus =
	| 'initializing'
	| 'running'
	| 'waiting'
	| 'paused'
	| 'completing'
	| 'completed'
	| 'failed'
	| 'terminated';

/**
 * Input to send to an agent.
 */
export interface AgentInput {
	/** User message to send */
	message?: string;
	/** Additional context to inject */
	context?: Record<string, unknown>;
}

/**
 * Limits on agent execution.
 */
export interface AgentLimits {
	/** Maximum duration in milliseconds */
	maxDurationMs?: number;
	/** Maximum number of turns (LLM calls) */
	maxTurns?: number;
	/** Maximum tokens to use */
	maxTokens?: number;
}

/**
 * Configuration for spawning a new agent.
 */
export interface AgentSpawnConfig {
	/** Path to the guidance folder containing SOUL.md, INSTRUCTIONS.md, etc. */
	guidancePath: string;
	/** Optional task ID to load */
	task?: string;
	/** Initial input to the agent */
	input?: AgentInput;
	/** Execution limits */
	limits?: AgentLimits;
	/** Tools available to the agent */
	tools: ToolRegistryInterface;
	/** Tags for filtering agents */
	tags?: string[];
	/** Arbitrary metadata */
	metadata?: Record<string, unknown>;
	/** Parent session ID if this is a child agent */
	parentId?: AgentSessionId;
}

/**
 * Result of an agent's execution.
 */
export interface AgentResult {
	/** Final status */
	status: 'completed' | 'failed' | 'terminated';
	/** Output from the agent */
	output?: string;
	/** Error message if failed */
	error?: string;
	/** Execution metrics */
	metrics: AgentMetrics;
}

/**
 * Metrics about an agent's execution.
 */
export interface AgentMetrics {
	/** Total duration in milliseconds */
	durationMs: number;
	/** Number of turns (LLM calls) */
	turns: number;
	/** Tokens used (if available) */
	tokensUsed?: {
		input: number;
		output: number;
		total: number;
	};
	/** Number of tool calls */
	toolCalls: number;
}

/**
 * Partial metrics during execution.
 */
export interface PartialAgentMetrics {
	/** Duration so far in milliseconds */
	durationMs: number;
	/** Turns so far */
	turns: number;
	/** Tokens used so far */
	tokensUsed?: {
		input: number;
		output: number;
		total: number;
	};
	/** Tool calls so far */
	toolCalls: number;
}

/**
 * Function to dispose of a subscription or resource.
 */
export type Disposable = () => void;

/**
 * Filter for listing agents.
 */
export interface AgentFilter {
	/** Filter by status */
	status?: AgentStatus | AgentStatus[];
	/** Filter by tags (any match) */
	tags?: string[];
	/** Filter by parent ID */
	parentId?: AgentSessionId;
}

/**
 * Snapshot of an agent's state for persistence.
 */
export interface AgentSnapshot {
	/** Snapshot ID */
	id: string;
	/** Session ID */
	sessionId: AgentSessionId;
	/** When the snapshot was taken */
	timestamp: number;
	/** Current status */
	status: AgentStatus;
	/** Partial metrics */
	metrics: PartialAgentMetrics;
}

/**
 * Options for coordinator shutdown.
 */
export interface ShutdownOptions {
	/** Wait for running agents to complete */
	graceful?: boolean;
	/** Timeout for graceful shutdown in milliseconds */
	timeoutMs?: number;
}

/**
 * Status of the coordinator.
 */
export type CoordinatorStatus = 'stopped' | 'starting' | 'running' | 'stopping';
