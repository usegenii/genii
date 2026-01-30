/**
 * Event types for the orchestrator system.
 */

import type { ToolProgress } from '../tools/types';
import type { AgentResult, AgentSessionId, AgentStatus } from '../types/core';

/**
 * Information about a pending suspension request.
 */
export interface PendingRequestInfo {
	/** Unique ID for this tool call */
	toolCallId: string;
	/** Name of the tool that is suspended */
	toolName: string;
	/** Type of suspension */
	type: 'user_input' | 'approval' | 'event' | 'sleep';
	/** Request details */
	request: SuspensionRequestData;
	/** When the suspension started */
	suspendedAt: number;
}

/**
 * Union type for suspension request data.
 */
export type SuspensionRequestData = UserInputRequestData | ApprovalRequestData | EventRequestData | SleepRequestData;

export interface UserInputRequestData {
	type: 'user_input';
	prompt: string;
	schema?: unknown;
	timeout?: number;
}

export interface ApprovalRequestData {
	type: 'approval';
	action: string;
	description?: string;
	details?: Record<string, unknown>;
	timeout?: number;
}

export interface EventRequestData {
	type: 'event';
	eventName: string;
	timeout?: number;
}

export interface SleepRequestData {
	type: 'sleep';
	durationMs: number;
	wakeAt: number;
}

/**
 * Resolution for a pending request.
 */
export interface PendingResolution {
	/** Tool call ID to resolve */
	toolCallId: string;
	/** Result to return (for user_input or event) */
	result?: unknown;
	/** For approvals */
	approved?: boolean;
	/** Reason for approval/rejection */
	reason?: string;
	/** Whether to cancel the suspension */
	cancel?: boolean;
}

/**
 * Events emitted by an agent.
 */
export type AgentEvent =
	| AgentStatusEvent
	| AgentOutputEvent
	| AgentThoughtEvent
	| AgentToolStartEvent
	| AgentToolProgressEvent
	| AgentToolEndEvent
	| AgentSuspendedEvent
	| AgentMemoryUpdatedEvent
	| AgentErrorEvent
	| AgentDoneEvent;

/**
 * Status change event.
 */
export interface AgentStatusEvent {
	type: 'status';
	status: AgentStatus;
	previousStatus?: AgentStatus;
	timestamp: number;
}

/**
 * Output text event (streamed or final).
 */
export interface AgentOutputEvent {
	type: 'output';
	/** The text content */
	text: string;
	/** Whether this is the final output for this turn */
	final: boolean;
	timestamp: number;
}

/**
 * Internal reasoning/thought event.
 */
export interface AgentThoughtEvent {
	type: 'thought';
	/** The thought content */
	content: string;
	timestamp: number;
}

/**
 * Tool execution started event.
 */
export interface AgentToolStartEvent {
	type: 'tool_start';
	/** Unique ID for this tool call */
	toolCallId: string;
	/** Name of the tool */
	toolName: string;
	/** Input to the tool */
	input: unknown;
	timestamp: number;
}

/**
 * Tool execution progress event.
 */
export interface AgentToolProgressEvent {
	type: 'tool_progress';
	/** Unique ID for this tool call */
	toolCallId: string;
	/** Name of the tool */
	toolName: string;
	/** Progress information */
	progress: ToolProgress;
	timestamp: number;
}

/**
 * Tool execution completed event.
 */
export interface AgentToolEndEvent {
	type: 'tool_end';
	/** Unique ID for this tool call */
	toolCallId: string;
	/** Name of the tool */
	toolName: string;
	/** Output from the tool (if successful) */
	output?: unknown | undefined;
	/** Error message (if failed) */
	error?: string | undefined;
	/** Duration in milliseconds */
	durationMs: number;
	timestamp: number;
}

/**
 * Agent suspended waiting for external input.
 */
export interface AgentSuspendedEvent {
	type: 'suspended';
	/** List of pending requests */
	pendingRequests: PendingRequestInfo[];
	timestamp: number;
}

/**
 * Memory was updated event.
 */
export interface AgentMemoryUpdatedEvent {
	type: 'memory_updated';
	/** Path that was updated */
	path: string;
	/** Operation performed */
	operation: 'write' | 'delete';
	timestamp: number;
}

/**
 * Error event.
 */
export interface AgentErrorEvent {
	type: 'error';
	/** Error message */
	error: string;
	/** Whether this error is fatal (agent will stop) */
	fatal: boolean;
	/** Stack trace if available */
	stack?: string | undefined;
	timestamp: number;
}

/**
 * Agent completed event.
 */
export interface AgentDoneEvent {
	type: 'done';
	/** Final result */
	result: AgentResult;
	timestamp: number;
}

/**
 * Events emitted by the coordinator.
 */
export type CoordinatorEvent = CoordinatorAgentSpawnedEvent | CoordinatorAgentEventEvent | CoordinatorAgentDoneEvent;

/**
 * New agent was spawned.
 */
export interface CoordinatorAgentSpawnedEvent {
	type: 'agent_spawned';
	/** Session ID of the new agent */
	sessionId: AgentSessionId;
	/** Tags of the new agent */
	tags?: string[] | undefined;
	/** Parent ID if this is a child agent */
	parentId?: AgentSessionId | undefined;
	timestamp: number;
}

/**
 * Event from a managed agent.
 */
export interface CoordinatorAgentEventEvent {
	type: 'agent_event';
	/** Session ID of the agent */
	sessionId: AgentSessionId;
	/** The event from the agent */
	event: AgentEvent;
	timestamp: number;
}

/**
 * Agent completed execution.
 */
export interface CoordinatorAgentDoneEvent {
	type: 'agent_done';
	/** Session ID of the agent */
	sessionId: AgentSessionId;
	/** Final result */
	result: AgentResult;
	timestamp: number;
}
