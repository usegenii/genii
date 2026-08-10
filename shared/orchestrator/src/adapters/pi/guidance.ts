/**
 * Guidance integration for Pi adapter.
 */

import type { AgentToolResult, AgentTool as PiAgentTool } from '@mariozechner/pi-agent-core';
import type { Static, TSchema } from '@sinclair/typebox';
import type { GuidanceContext } from '../../guidance/types';
import { formatSkillsForPrompt } from '../../skills/format';
import type { LoadedSkill } from '../../skills/types';
import { createStepContext, type StepContextImpl } from '../../tools/step-context';
import { isSuspensionError } from '../../tools/suspension';
import type {
	CompletedStep,
	StepResumeData,
	SuspensionRequest,
	Tool,
	ToolContext,
	ToolExecutionState,
	ToolResult,
} from '../../tools/types';

/**
 * Build the system prompt from guidance context.
 * @deprecated Use context injectors instead. Soul, instructions, and skills are now
 * injected via SoulContextInjector, InstructionsContextInjector, and SkillsContextInjector.
 */
export function buildSystemPrompt(guidance: GuidanceContext, skills?: LoadedSkill[]): string {
	const parts: string[] = [];

	// Add SOUL.md
	if (guidance.soul) {
		parts.push(guidance.soul);
	}

	// Add INSTRUCTIONS.md
	if (guidance.instructions) {
		parts.push(guidance.instructions);
	}

	// Add available skills
	if (skills && skills.length > 0) {
		const skillsSection = formatSkillsForPrompt(skills);
		if (skillsSection) {
			parts.push(skillsSection);
		}
	}

	return parts.join('\n\n---\n\n');
}

/**
 * Build system prompt with task content and optional injected context.
 * @deprecated Use context injectors instead. The system prompt is now built entirely
 * via the ContextInjectorRegistry.collectSystemContext() method.
 */
export async function buildSystemPromptWithTask(
	guidance: GuidanceContext,
	taskId?: string,
	skills?: LoadedSkill[],
	systemContext?: string,
): Promise<string> {
	const parts: string[] = [];

	// Add SOUL.md
	if (guidance.soul) {
		parts.push(guidance.soul);
	}

	// Add INSTRUCTIONS.md
	if (guidance.instructions) {
		parts.push(guidance.instructions);
	}

	// Add available skills
	if (skills && skills.length > 0) {
		const skillsSection = formatSkillsForPrompt(skills);
		if (skillsSection) {
			parts.push(skillsSection);
		}
	}

	// Add task content if specified
	if (taskId) {
		const task = await guidance.loadTask(taskId);
		if (task) {
			parts.push(`# Current Task: ${task.title}\n\n${task.content}`);
		}
	}

	// Add injected system context
	if (systemContext) {
		parts.push(systemContext);
	}

	return parts.join('\n\n---\n\n');
}

/**
 * Context for tracking tool execution state during suspension.
 */
export interface ToolExecutionTracker {
	/** Execution state is isolated by Pi's stable tool-call ID. */
	executions: Map<string, TrackedToolExecution>;
}

/** Runtime-only state for one executing tool call. */
export interface TrackedToolExecution {
	toolCallId: string;
	toolName: string;
	input: unknown;
	stepContext: StepContextImpl;
	completedSteps: CompletedStep[];
}

/** Snapshot passed to the durable suspension lifecycle. */
export interface ToolSuspensionContext {
	toolCallId: string;
	toolName: string;
	input: unknown;
	stepId: string;
	request: SuspensionRequest;
	completedSteps: CompletedStep[];
}

/** Snapshot of a tool invocation immediately before Pi receives its result. */
export interface ToolCompletionContext {
	toolCallId: string;
	toolName: string;
	input: unknown;
	completedSteps: CompletedStep[];
}

/**
 * Create a tool execution tracker.
 */
export function createToolExecutionTracker(): ToolExecutionTracker {
	return {
		executions: new Map(),
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
	onSuspend?: (suspension: ToolSuspensionContext) => Promise<StepResumeData>,
	getResumeData?: (toolCallId: string) => ToolExecutionState | undefined,
	onComplete?: (completion: ToolCompletionContext, result: AgentToolResult<unknown>) => Promise<void>,
): PiAgentTool<TSchema>[] {
	return tools.map((tool) =>
		convertTool(tool, sessionId, guidance, abortSignal, tracker, onProgress, onSuspend, getResumeData, onComplete),
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
	onSuspend?: (suspension: ToolSuspensionContext) => Promise<StepResumeData>,
	getResumeData?: (toolCallId: string) => ToolExecutionState | undefined,
	onComplete?: (completion: ToolCompletionContext, result: AgentToolResult<unknown>) => Promise<void>,
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
			let completedSteps = getResumeData?.(toolCallId)?.completedSteps ?? [];
			let resumeData = getResumeData?.(toolCallId)?.suspendedStep?.resumeData;

			// A suspension unwinds the user tool, but never escapes into Pi's
			// error-finalization path. Once resolved, the wrapper replays the same
			// invocation with memoized steps and the exact suspended step result.
			while (true) {
				const stepContext = createStepContext({ completedSteps, resumeData });
				tracker.executions.set(toolCallId, {
					toolCallId,
					toolName: tool.name,
					input: params,
					stepContext,
					completedSteps,
				});

				const context: ToolContext = {
					sessionId,
					guidance,
					signal: signal ?? abortSignal,
					step: stepContext,
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
						console[level]?.(`[${tool.name}] ${message}`);
					},
				};

				let toolResult: AgentToolResult<unknown>;
				try {
					toolResult = toolResultToAgentToolResult(await tool.execute(params, context));
				} catch (error) {
					completedSteps = stepContext.getCompletedSteps();
					if (!isSuspensionError(error)) {
						toolResult = {
							content: [
								{
									type: 'text',
									text: error instanceof Error ? error.message : String(error),
								},
							],
							details: undefined,
						};
					} else if (!onSuspend) {
						tracker.executions.delete(toolCallId);
						throw new Error(`Tool "${tool.name}" suspended without a suspension lifecycle`);
					} else {
						resumeData = await onSuspend({
							toolCallId,
							toolName: tool.name,
							input: params,
							stepId: error.stepId,
							request: error.request,
							completedSteps,
						});
						continue;
					}
				}

				completedSteps = stepContext.getCompletedSteps();
				await onComplete?.({ toolCallId, toolName: tool.name, input: params, completedSteps }, toolResult);
				tracker.executions.delete(toolCallId);
				return toolResult;
			}
		},
	};
}

/**
 * Convert our ToolResult to Pi's AgentToolResult.
 */
function toolResultToAgentToolResult(result: ToolResult<unknown>): AgentToolResult<unknown> {
	if (result.status === 'success') {
		const text =
			typeof result.output === 'string'
				? result.output
				: result.output === undefined
					? ''
					: JSON.stringify(result.output, null, 2);
		return {
			content: [{ type: 'text', text }],
			details: result.details,
		};
	}
	// Error result
	return {
		content: [{ type: 'text', text: result.error }],
		details: { retryable: result.retryable },
	};
}
