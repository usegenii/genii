/**
 * Guidance integration for Pi adapter.
 */

import type { AgentToolResult, AgentTool as PiAgentTool } from '@mariozechner/pi-agent-core';
import type { Static, TSchema } from '@sinclair/typebox';
import type { GuidanceContext } from '../../guidance/types.js';
import type { ToolExecutionState } from '../../snapshot/types.js';
import { createStepContext, type StepContextImpl } from '../../tools/step-context.js';
import { isSuspensionError } from '../../tools/suspension.js';
import type { StepResumeData, SuspensionRequest, Tool, ToolContext, ToolResult } from '../../tools/types.js';

/**
 * Build the system prompt from guidance context.
 */
export function buildSystemPrompt(guidance: GuidanceContext): string {
	const parts: string[] = [];

	// Add SOUL.md
	if (guidance.soul) {
		parts.push(guidance.soul);
	}

	// Add INSTRUCTIONS.md
	if (guidance.instructions) {
		parts.push(guidance.instructions);
	}

	// Add task-specific instructions (loaded separately)
	// The task content would be injected here if provided

	return parts.join('\n\n---\n\n');
}

/**
 * Build system prompt with task content.
 */
export async function buildSystemPromptWithTask(guidance: GuidanceContext, taskId?: string): Promise<string> {
	const parts: string[] = [];

	// Add SOUL.md
	if (guidance.soul) {
		parts.push(guidance.soul);
	}

	// Add INSTRUCTIONS.md
	if (guidance.instructions) {
		parts.push(guidance.instructions);
	}

	// Add task content if specified
	if (taskId) {
		const task = await guidance.loadTask(taskId);
		if (task) {
			parts.push(`# Current Task: ${task.title}\n\n${task.content}`);
		}
	}

	return parts.join('\n\n---\n\n');
}

/**
 * Context for tracking tool execution state during suspension.
 */
export interface ToolExecutionTracker {
	/** Current tool call ID */
	toolCallId: string | null;
	/** Current tool name */
	toolName: string | null;
	/** Current tool input */
	toolInput: unknown | null;
	/** Step context for current execution */
	stepContext: StepContextImpl | null;
	/** Suspended requests */
	suspendedRequests: Map<string, { request: SuspensionRequest; stepId: string }>;
	/** Resume data for suspended steps */
	resumeData: Map<string, StepResumeData>;
}

/**
 * Create a tool execution tracker.
 */
export function createToolExecutionTracker(): ToolExecutionTracker {
	return {
		toolCallId: null,
		toolName: null,
		toolInput: null,
		stepContext: null,
		suspendedRequests: new Map(),
		resumeData: new Map(),
	};
}

/**
 * Convert our tools to Pi AgentTools.
 */
export function buildPiTools(
	tools: Tool<unknown, unknown>[],
	sessionId: string,
	guidance: GuidanceContext,
	abortSignal: AbortSignal,
	tracker: ToolExecutionTracker,
	onProgress?: (toolCallId: string, toolName: string, progress: unknown) => void,
	onSuspend?: (toolCallId: string, toolName: string, stepId: string, request: SuspensionRequest) => void,
	getResumeData?: (toolCallId: string) => ToolExecutionState | undefined,
): PiAgentTool<TSchema>[] {
	return tools.map((tool) =>
		convertTool(tool, sessionId, guidance, abortSignal, tracker, onProgress, onSuspend, getResumeData),
	);
}

/**
 * Convert a single tool to a Pi AgentTool.
 */
function convertTool(
	tool: Tool<unknown, unknown>,
	sessionId: string,
	guidance: GuidanceContext,
	abortSignal: AbortSignal,
	tracker: ToolExecutionTracker,
	onProgress?: (toolCallId: string, toolName: string, progress: unknown) => void,
	onSuspend?: (toolCallId: string, toolName: string, stepId: string, request: SuspensionRequest) => void,
	getResumeData?: (toolCallId: string) => ToolExecutionState | undefined,
): PiAgentTool<TSchema> {
	return {
		name: tool.name,
		label: tool.label ?? tool.name,
		description: tool.description,
		parameters: tool.parameters,
		execute: async (
			toolCallId: string,
			params: Static<TSchema>,
			signal?: AbortSignal,
			onUpdate?: (partialResult: AgentToolResult<unknown>) => void,
		): Promise<AgentToolResult<unknown>> => {
			// Set up tracking
			tracker.toolCallId = toolCallId;
			tracker.toolName = tool.name;
			tracker.toolInput = params;

			// Check for resume data
			const existingState = getResumeData?.(toolCallId);
			tracker.stepContext = createStepContext({
				completedSteps: existingState?.completedSteps,
				resumeData: tracker.resumeData.get(toolCallId),
				onEvent: (event) => {
					if (event.type === 'suspended') {
						const suspensionRequest = event.request as SuspensionRequest;
						const stepId = `${toolCallId}:${tracker.stepContext?.getCompletedSteps().length ?? 0}`;
						tracker.suspendedRequests.set(toolCallId, {
							request: suspensionRequest,
							stepId,
						});
						onSuspend?.(toolCallId, tool.name, stepId, suspensionRequest);
					}
				},
			});

			// Create tool context
			const context: ToolContext = {
				sessionId,
				guidance,
				signal: signal ?? abortSignal,
				step: tracker.stepContext,
				emitProgress: (progress) => {
					onProgress?.(toolCallId, tool.name, progress);
					if (onUpdate && progress.message) {
						onUpdate({
							content: [{ type: 'text', text: progress.message }],
							details: progress.data,
						});
					}
				},
				log: (level, message) => {
					// Could be connected to a logging system
					console[level]?.(`[${tool.name}] ${message}`);
				},
			};

			try {
				const result = await tool.execute(params, context);

				// Clear tracking
				tracker.toolCallId = null;
				tracker.toolName = null;
				tracker.toolInput = null;
				tracker.stepContext = null;
				tracker.suspendedRequests.delete(toolCallId);

				return toolResultToAgentToolResult(result);
			} catch (error) {
				// Check for suspension
				if (isSuspensionError(error)) {
					// The suspension has been tracked via onEvent
					// Re-throw to let the adapter handle it
					throw error;
				}

				// Clear tracking on error
				tracker.toolCallId = null;
				tracker.toolName = null;
				tracker.toolInput = null;
				tracker.stepContext = null;

				// Return error result
				return {
					content: [
						{
							type: 'text',
							text: error instanceof Error ? error.message : String(error),
						},
					],
					details: undefined,
				};
			}
		},
	};
}

/**
 * Convert our ToolResult to Pi's AgentToolResult.
 */
function toolResultToAgentToolResult(result: ToolResult<unknown>): AgentToolResult<unknown> {
	if (result.status === 'success') {
		return {
			content: [
				{
					type: 'text',
					text: typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2),
				},
			],
			details: result.details,
		};
	}
	// Error result
	return {
		content: [{ type: 'text', text: result.error }],
		details: { retryable: result.retryable },
	};
}
