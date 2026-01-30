/**
 * Tool system types.
 *
 * This is the canonical location for all tool-related types.
 */

import type { TSchema } from '@sinclair/typebox';
import type { GuidanceContext } from '../guidance/types.js';

/**
 * JSON Schema type for tool parameters.
 */
export type JsonSchema = TSchema;

/**
 * Log levels for tool context.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Progress update from a tool.
 */
export interface ToolProgress {
	/** Progress percentage (0-100) */
	percentage?: number;
	/** Status message */
	message?: string;
	/** Additional data */
	data?: Record<string, unknown>;
}

/**
 * A tool definition.
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
	/** Unique name for the tool */
	name: string;
	/** Human-readable label */
	label?: string;
	/** Description of what the tool does */
	description: string;
	/** JSON Schema for the input parameters */
	parameters: JsonSchema;
	/** Execute the tool */
	execute: ToolExecutor<TInput, TOutput>;
	/** Category for grouping tools */
	category?: string;
	/** Whether this tool can suspend execution */
	canSuspend?: boolean;
}

/**
 * Tool executor function type.
 */
export type ToolExecutor<TInput, TOutput> = (input: TInput, context: ToolContext) => Promise<ToolResult<TOutput>>;

/**
 * Result of a tool execution.
 */
export type ToolResult<T> = ToolSuccess<T> | ToolError;

/**
 * Successful tool result.
 */
export interface ToolSuccess<T> {
	status: 'success';
	output: T;
	details?: Record<string, unknown>;
}

/**
 * Failed tool result.
 */
export interface ToolError {
	status: 'error';
	error: string;
	retryable?: boolean;
}

/**
 * Context provided to tool execution.
 */
export interface ToolContext {
	/** Session ID of the agent executing this tool */
	sessionId: string;
	/** Guidance context for accessing SOUL, instructions, tasks, skills, memory */
	guidance: GuidanceContext;
	/** Abort signal for cancellation */
	signal: AbortSignal;
	/** Step context for durable execution */
	step: StepContext;
	/** Emit progress updates */
	emitProgress(progress: ToolProgress): void;
	/** Log a message */
	log(level: LogLevel, message: string): void;
}

/**
 * Step context for durable execution.
 * Provides methods to run steps with memoization and suspend for external input.
 */
export interface StepContext {
	/**
	 * Run a step with memoization.
	 * If the step was previously executed, returns the memoized result.
	 * Otherwise, executes the function and stores the result.
	 *
	 * @param stepId - Unique identifier for this step within the tool execution
	 * @param fn - Function to execute
	 * @returns Result of the function
	 */
	run<T>(stepId: string, fn: () => Promise<T>): Promise<T>;

	/**
	 * Suspend execution to wait for user input.
	 * The agent will be paused until the user provides input.
	 *
	 * @param request - User input request details
	 * @returns User-provided input
	 */
	waitForUserInput<T = unknown>(request: UserInputRequest): Promise<T>;

	/**
	 * Suspend execution to wait for approval.
	 * The agent will be paused until the action is approved or rejected.
	 *
	 * @param request - Approval request details
	 * @returns Approval response
	 */
	waitForApproval(request: ApprovalRequest): Promise<ApprovalResponse>;

	/**
	 * Suspend execution to wait for an external event.
	 * The agent will be paused until the event is received or times out.
	 *
	 * @param eventName - Name of the event to wait for
	 * @param options - Wait options including timeout
	 * @returns Event data or null if timed out
	 */
	waitForEvent<T = unknown>(eventName: string, options?: WaitOptions): Promise<T | null>;

	/**
	 * Suspend execution for a specified duration.
	 * The agent will be paused for the specified time.
	 *
	 * @param ms - Duration to sleep in milliseconds
	 */
	sleep(ms: number): Promise<void>;
}

/**
 * User input request for tool suspension.
 */
export interface UserInputRequest {
	prompt: string;
	schema?: JsonSchema;
	timeout?: number;
}

/**
 * Approval request for tool suspension.
 */
export interface ApprovalRequest {
	action: string;
	description?: string;
	details?: Record<string, unknown>;
	timeout?: number;
}

/**
 * Response to an approval request.
 */
export interface ApprovalResponse {
	approved: boolean;
	reason?: string;
}

/**
 * Options for waiting operations.
 */
export interface WaitOptions {
	timeout?: number;
}

/**
 * Tool registry interface.
 */
export interface ToolRegistryInterface {
	/** Register a tool */
	register<TInput, TOutput>(tool: Tool<TInput, TOutput>): void;
	/** Get a tool by name */
	get(name: string): Tool<unknown, unknown> | undefined;
	/** Get all tools */
	all(): Tool<unknown, unknown>[];
	/** Get tools by category */
	byCategory(category: string): Tool<unknown, unknown>[];
	/** Create a new registry that includes tools from both registries */
	extend(registry: ToolRegistryInterface): ToolRegistryInterface;
}

/**
 * Completed step information for checkpointing.
 */
export interface CompletedStep {
	stepId: string;
	result: unknown;
	completedAt: number;
}

/**
 * Suspended step information for checkpointing.
 */
export interface SuspendedStep {
	stepId: string;
	request: SuspensionRequest;
	suspendedAt: number;
}

/**
 * Suspension request types.
 */
export type SuspensionRequest = UserInputSuspension | ApprovalSuspension | EventSuspension | SleepSuspension;

export interface UserInputSuspension {
	type: 'user_input';
	request: UserInputRequest;
}

export interface ApprovalSuspension {
	type: 'approval';
	request: ApprovalRequest;
}

export interface EventSuspension {
	type: 'event';
	eventName: string;
	options?: WaitOptions | undefined;
}

export interface SleepSuspension {
	type: 'sleep';
	durationMs: number;
	wakeAt: number;
}

/**
 * State of a tool execution for checkpointing.
 */
export interface ToolExecutionState {
	toolName: string;
	toolCallId: string;
	input: unknown;
	completedSteps: CompletedStep[];
	suspendedStep?: SuspendedStep;
}

/**
 * Resume data for a suspended step.
 */
export interface StepResumeData {
	stepId: string;
	result: unknown;
}

/**
 * Callback for step context events.
 */
export type StepContextEventCallback = (event: StepContextEvent) => void;

/**
 * Events emitted by step context.
 */
export type StepContextEvent =
	| { type: 'step_start'; stepId: string }
	| { type: 'step_end'; stepId: string; result: unknown }
	| { type: 'step_memoized'; stepId: string; result: unknown }
	| { type: 'suspended'; request: SuspensionRequest };

/**
 * Options for creating a step context.
 */
export interface StepContextOptions {
	/** Previously completed steps for memoization */
	completedSteps?: CompletedStep[] | undefined;
	/** Resume data for a suspended step */
	resumeData?: StepResumeData | undefined;
	/** Event callback */
	onEvent?: StepContextEventCallback | undefined;
}
