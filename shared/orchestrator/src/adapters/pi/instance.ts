/**
 * Pi agent instance implementation.
 */

import type { AgentMessage, AgentToolResult, AgentTool as PiAgentTool, StreamFn } from '@mariozechner/pi-agent-core';
import { Agent } from '@mariozechner/pi-agent-core';
import type { Api, Message, Model } from '@mariozechner/pi-ai';
import { getModels, streamSimple } from '@mariozechner/pi-ai';
import type { AgentEvent, PendingRequestInfo, PendingResolution, SuspensionRequestData } from '../../events/types';
import { type AgentCheckpoint, CHECKPOINT_VERSION, type InstanceCheckpoint } from '../../snapshot/types';
import { createToolRegistry } from '../../tools/registry';
import {
	createSuspensionId,
	getSuspensionDeadline,
	isIdenticalResolution,
	normalizeSuspensionResolution,
} from '../../tools/suspension';
import type {
	StepResumeData,
	SuspensionId,
	SuspensionRequest,
	SuspensionResolution,
	ToolExecutionState,
} from '../../tools/types';
import type { AgentInput, AgentSessionId } from '../../types/core';
import { generateAgentSessionId } from '../../types/core';
import { type Logger, noopLogger } from '../../types/logger';
import type { AdapterCreateConfig, AgentInstance, AgentInstanceStatus } from '../types';
import { mapPiEvent } from './events';
import {
	buildPiTools,
	buildSystemPromptWithTask,
	createToolExecutionTracker,
	type ToolCompletionContext,
	type ToolExecutionTracker,
	type ToolSuspensionContext,
} from './guidance';
import { agentToolResultToPiMessage, checkpointToPiMessages, piMessagesToCheckpoint } from './messages';
import type { PiAdapterOptions } from './types';

/**
 * Async event queue for streaming events from callbacks to async iterators.
 * Allows pushing events from a synchronous callback and pulling them asynchronously.
 */
class AsyncEventQueue<T> {
	private queue: T[] = [];
	private waiters: Array<(item: T | null) => void> = [];
	private closed = false;

	/**
	 * Push an event to the queue. If there are waiters, resolve the first one immediately.
	 */
	push(item: T): void {
		if (this.closed) return;
		const resolve = this.waiters.shift();
		if (resolve) {
			resolve(item);
		} else {
			this.queue.push(item);
		}
	}

	/**
	 * Pull the next event from the queue. Returns null when the queue is closed and empty.
	 */
	async pull(): Promise<T | null> {
		const item = this.queue.shift();
		if (item !== undefined) {
			return item;
		}
		if (this.closed) return null;
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	/**
	 * Close the queue. All pending waiters will receive null.
	 */
	close(): void {
		this.closed = true;
		for (const resolve of this.waiters) {
			resolve(null);
		}
		this.waiters = [];
	}
}

/**
 * Options for restoring an agent instance from a checkpoint.
 */
export interface RestoreOptions {
	/** Pre-existing messages (in Pi format, already transformed) */
	messages: Message[];
	/** Session ID to reuse */
	sessionId: AgentSessionId;
	/** Created timestamp to preserve */
	createdAt: number;
	/** Initial turn count */
	turnCount: number;
	/** Provider name */
	provider: string;
	/** Model ID */
	modelId: string;
	/** Durable in-flight tool invocations. */
	toolExecutions: ToolExecutionState[];
}

interface SuspensionResolver {
	resolve: (value: StepResumeData) => void;
	reject: (error: unknown) => void;
}

/**
 * Pi agent instance.
 */
export class PiAgentInstance implements AgentInstance {
	readonly id: string;
	private agent: Agent;
	private streamFn: StreamFn;
	private config: AdapterCreateConfig;
	private _status: AgentInstanceStatus = 'idle';
	private pendingRequests: PendingRequestInfo[] = [];
	private abortController = new AbortController();
	private toolCallTimes = new Map<string, number>();
	private toolExecutionStates = new Map<string, ToolExecutionState>();
	private tracker: ToolExecutionTracker;
	private pausePromise: Promise<void> | null = null;
	private pauseResolve: (() => void) | null = null;
	private suspensionResolvers = new Map<SuspensionId, SuspensionResolver>();
	private resolutionBarriers = new Map<SuspensionId, Promise<void>>();
	private activeEventQueue: AsyncEventQueue<AgentEvent> | null = null;
	private fatalLifecycleError: unknown = null;
	private turnCount = 0;
	private startTime = Date.now();
	private inputQueue: AgentInput[] = [];
	private createdAt = Date.now();
	private apiKeyGetter?: () => Promise<string | undefined>;
	private thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' = 'low';
	private logger: Logger;

	constructor(
		config: AdapterCreateConfig,
		model: Model<Api>,
		systemPrompt: string,
		options: {
			apiKey?: string | (() => Promise<string | undefined>);
			thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
			restoreOptions?: RestoreOptions;
			/** Test/custom transport hook; normal adapter creation uses streamSimple. */
			streamFn?: StreamFn;
		} = {},
	) {
		// Use restored session ID if available, otherwise generate new
		this.id = options.restoreOptions?.sessionId ?? generateAgentSessionId();
		this.config = config;
		this.tracker = createToolExecutionTracker();
		this.logger = (config.logger ?? noopLogger).child({ component: 'PiAgentInstance', agentId: this.id });

		// Restore timestamps if provided
		if (options.restoreOptions) {
			this.createdAt = options.restoreOptions.createdAt;
			this.turnCount = options.restoreOptions.turnCount;
			for (const execution of options.restoreOptions.toolExecutions) {
				this.toolExecutionStates.set(execution.toolCallId, execution);
				if (execution.suspendedStep) {
					this.pendingRequests.push(this.executionToPendingRequest(execution));
				}
			}
			if (this.pendingRequests.length > 1) {
				throw new Error('Checkpoint contains concurrent suspensions, which are not supported');
			}
			if (this.pendingRequests.length > 0) {
				this._status = 'waiting';
			}
		}

		if (typeof options.apiKey === 'function') {
			this.apiKeyGetter = options.apiKey;
		} else if (typeof options.apiKey === 'string') {
			// Wrap string API key in an async getter for uniform handling
			const key = options.apiKey;
			this.apiKeyGetter = async () => key;
		}

		if (options.thinkingLevel && options.thinkingLevel !== 'off') {
			this.thinkingLevel = options.thinkingLevel;
		}

		// Build Pi tools from our tools (use empty registry if not provided)
		const toolRegistry = config.tools ?? createToolRegistry();
		const piTools = buildPiTools(
			toolRegistry.all(),
			this.id,
			config.guidance,
			this.abortController.signal,
			this.tracker,
			// Progress callback
			(_toolCallId, _toolName, _progress) => {
				// Progress is emitted through events
			},
			// Suspension callback
			(suspension) => this.handleSuspension(suspension),
			// Get resume data
			(toolCallId) => this.toolExecutionStates.get(toolCallId),
			// Persist the real tool result before Pi begins its next model turn.
			(completion, result) => this.handleToolCompletion(completion, result),
		);

		// Get initial messages - either from restore or empty
		const initialMessages = options.restoreOptions?.messages ?? [];

		this.streamFn =
			options.streamFn ??
			(async (...args) => {
				if (this.apiKeyGetter) {
					const apiKey = await this.apiKeyGetter();
					if (apiKey) args[2] = { ...args[2], apiKey };
				}
				return streamSimple(...args);
			});

		// Create the Pi Agent
		this.agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: this.thinkingLevel,
				tools: piTools,
				messages: initialMessages as AgentMessage[],
			},
			streamFn: this.streamFn,
			steeringMode: 'one-at-a-time',
			followUpMode: 'one-at-a-time',
			// Tool execution state is shared across calls, so preserve pi 0.49's serial behavior.
			toolExecution: 'sequential',
		});

		// Queue initial input
		if (config.input) {
			this.inputQueue.push(config.input);
		}
	}

	async *run(): AsyncIterable<AgentEvent> {
		if (this.fatalLifecycleError && this.getSuspendedExecution()) {
			this.rebuildAgentAfterLifecycleFailure();
			this.fatalLifecycleError = null;
		}
		this._status = 'running';
		this.startTime = Date.now();

		yield {
			type: 'status',
			status: 'running',
			timestamp: Date.now(),
		};

		try {
			const initialInput = this.inputQueue.shift();
			const restoredExecution = this.getSuspendedExecution();
			if (initialInput?.message || restoredExecution) {
				if (initialInput?.message) {
					this.logger.debug({ messageLength: initialInput.message.length }, 'Processing initial input');
				}

				const eventQueue = new AsyncEventQueue<AgentEvent>();
				this.activeEventQueue = eventQueue;
				const unsubscribe = this.agent.subscribe((piEvent) => {
					this.logger.debug({ piEventType: piEvent.type }, 'Pi event received');
					const mapped = mapPiEvent(piEvent, this.toolCallTimes);
					if (Array.isArray(mapped)) {
						for (const event of mapped) eventQueue.push(event);
					} else if (mapped) {
						eventQueue.push(mapped);
					}
					if (piEvent.type === 'turn_end') this.turnCount++;
				});

				let operationError: unknown = null;
				const operation = initialInput?.message
					? this.agent.prompt(initialInput.message)
					: this.replayRestoredExecution(restoredExecution as ToolExecutionState);
				const operationPromise = operation
					.catch((error) => {
						operationError = error;
					})
					.finally(() => {
						unsubscribe();
						this.activeEventQueue = null;
						eventQueue.close();
					});

				while (true) {
					const event = await eventQueue.pull();
					if (event === null) break;
					if (this.pausePromise) {
						yield { type: 'status', status: 'paused', timestamp: Date.now() };
						await this.pausePromise;
						yield { type: 'status', status: 'running', timestamp: Date.now() };
					}
					yield event;
				}

				if (this.fatalLifecycleError) {
					unsubscribe();
					this.activeEventQueue = null;
					throw this.fatalLifecycleError;
				}
				await operationPromise;
				if (operationError) throw operationError;

				await this.clearCompletedToolExecutions();
				const lastMsg = this.agent.state.messages[this.agent.state.messages.length - 1];
				if (lastMsg && 'stopReason' in lastMsg && lastMsg.stopReason === 'error') {
					throw new Error(`LLM returned error response: ${this.extractErrorFromMessage(lastMsg)}`);
				}
			} else {
				this.logger.warn('No initial input or suspended tool invocation — skipping LLM call');
			}

			// Handle completion
			if (this.pendingRequests.length === 0) {
				this._status = 'completed';
				const output = this.getLastAssistantMessage();
				const lastMessage = this.agent.state.messages[this.agent.state.messages.length - 1];
				const stopReason = lastMessage && 'stopReason' in lastMessage ? lastMessage.stopReason : undefined;
				this.logger.debug(
					{
						stopReason,
						hasOutput: output !== undefined,
						outputLength: output?.length,
						messageCount: this.agent.state.messages.length,
					},
					'Agent completing',
				);
				if (output === undefined) {
					this.logger.warn(
						{ stopReason, messageCount: this.agent.state.messages.length },
						'Agent completed with no output text',
					);
				}
				yield {
					type: 'status',
					status: 'completed',
					timestamp: Date.now(),
				};
				yield {
					type: 'done',
					result: {
						status: 'completed',
						output,
						metrics: {
							durationMs: Date.now() - this.startTime,
							turns: this.turnCount,
							toolCalls: this.toolCallTimes.size,
						},
					},
					timestamp: Date.now(),
				};
			}
		} catch (error) {
			this._status = 'failed';
			yield {
				type: 'error',
				error: error instanceof Error ? error.message : String(error),
				fatal: true,
				stack: error instanceof Error ? error.stack : undefined,
				timestamp: Date.now(),
			};
			yield {
				type: 'done',
				result: {
					status: 'failed',
					error: error instanceof Error ? error.message : String(error),
					metrics: {
						durationMs: Date.now() - this.startTime,
						turns: this.turnCount,
						toolCalls: this.toolCallTimes.size,
					},
				},
				timestamp: Date.now(),
			};
		}
	}

	send(input: AgentInput): void {
		this.inputQueue.push(input);
		if (input.message && this._status === 'running') {
			this.agent.followUp({
				role: 'user',
				content: input.message,
				timestamp: Date.now(),
			});
		}
	}

	async pause(): Promise<void> {
		if (this._status === 'running') {
			this.pausePromise = new Promise((resolve) => {
				this.pauseResolve = resolve;
			});
			this._status = 'paused';
		}
	}

	async resume(): Promise<void> {
		if (this.pauseResolve) {
			this.pauseResolve();
			this.pausePromise = null;
			this.pauseResolve = null;
			this._status = 'running';
		}
	}

	abort(): void {
		this.abortController.abort();
		this.agent.abort();
		for (const resolver of this.suspensionResolvers.values()) {
			resolver.reject(new Error('Agent aborted while waiting for a suspension resolution'));
		}
		this.suspensionResolvers.clear();
		this._status = 'aborted';
	}

	async checkpoint(): Promise<InstanceCheckpoint> {
		const messages = this.agent.state.messages as Message[];

		return {
			version: CHECKPOINT_VERSION,
			timestamp: Date.now(),
			adapterName: 'pi',
			session: {
				id: this.id as AgentSessionId,
				parentId: this.config.parentId,
				createdAt: this.createdAt,
				tags: this.config.tags ?? [],
				metadata: this.config.metadata ?? {},
				task: this.config.task,
				metrics: {
					durationMs: Date.now() - this.startTime,
					turns: this.turnCount,
					toolCalls: this.toolCallTimes.size,
				},
			},
			guidance: {
				guidancePath: this.config.guidance.root,
				memoryWrites: [],
				systemState: {},
			},
			messages: piMessagesToCheckpoint(messages),
			adapterConfig: {
				thinkingLevel: this.thinkingLevel,
			},
			toolExecutions: [...this.toolExecutionStates.values()],
		};
	}

	status(): AgentInstanceStatus {
		return this._status;
	}

	getPendingRequests(): PendingRequestInfo[] {
		return [...this.pendingRequests];
	}

	async resolve(resolutions: PendingResolution[]): Promise<void> {
		if (resolutions.length === 0) return;
		if (resolutions.length > 1) {
			throw new Error('Only one active suspended invocation is supported per session');
		}

		const resolution = resolutions[0] as SuspensionResolution;
		const execution = this.findExecutionBySuspensionId(resolution.suspensionId);
		if (!execution?.suspendedStep) {
			throw new Error(`Suspension "${resolution.suspensionId}" is stale or does not exist`);
		}

		const suspendedStep = execution.suspendedStep;
		if (suspendedStep.status === 'resolved') {
			if (suspendedStep.resolution && isIdenticalResolution(suspendedStep.resolution, resolution)) {
				await this.resolutionBarriers.get(resolution.suspensionId);
				return;
			}
			throw new Error(`Suspension "${resolution.suspensionId}" already has a conflicting resolution`);
		}

		const resumeData = normalizeSuspensionResolution(suspendedStep.stepId, suspendedStep.request, resolution);
		suspendedStep.status = 'resolved';
		suspendedStep.resolution = resolution;
		suspendedStep.resumeData = resumeData;
		this.pendingRequests = [this.executionToPendingRequest(execution)];

		const resolutionBarrier = this.persistLifecycle('resolution_accepted');
		this.resolutionBarriers.set(resolution.suspensionId, resolutionBarrier);
		try {
			await resolutionBarrier;
		} catch (error) {
			suspendedStep.status = 'waiting';
			suspendedStep.resolution = undefined;
			suspendedStep.resumeData = undefined;
			this.pendingRequests = [this.executionToPendingRequest(execution)];
			throw error;
		} finally {
			this.resolutionBarriers.delete(resolution.suspensionId);
		}

		this._status = 'running';
		this.activeEventQueue?.push({ type: 'status', status: 'running', timestamp: Date.now() });
		const resolver = this.suspensionResolvers.get(resolution.suspensionId);
		if (resolver) {
			resolver.resolve(resumeData);
			this.suspensionResolvers.delete(resolution.suspensionId);
		}
	}

	private async handleSuspension(suspension: ToolSuspensionContext): Promise<StepResumeData> {
		const current = this.getSuspendedExecution();
		if (current?.suspendedStep && current.toolCallId !== suspension.toolCallId) {
			throw new Error('Concurrent tool suspensions are not supported');
		}

		const suspendedAt = Date.now();
		const suspensionId = createSuspensionId(suspension.toolCallId, suspension.stepId);
		const execution: ToolExecutionState = {
			toolName: suspension.toolName,
			toolCallId: suspension.toolCallId,
			input: suspension.input,
			completedSteps: suspension.completedSteps,
			suspendedStep: {
				suspensionId,
				stepId: suspension.stepId,
				request: suspension.request,
				suspendedAt,
				deadline: getSuspensionDeadline(suspension.request, suspendedAt),
				status: 'waiting',
			},
		};
		this.toolExecutionStates.set(suspension.toolCallId, execution);
		this.pendingRequests = [this.executionToPendingRequest(execution)];

		try {
			await this.persistLifecycle('suspended');
		} catch (error) {
			this.failLifecycle(error);
			return new Promise<StepResumeData>(() => {});
		}

		this._status = 'waiting';
		this.activeEventQueue?.push({ type: 'status', status: 'waiting', timestamp: Date.now() });
		this.activeEventQueue?.push({
			type: 'suspended',
			pendingRequests: [...this.pendingRequests],
			timestamp: Date.now(),
		});

		return this.waitForResolution(suspensionId);
	}

	private async handleToolCompletion(
		completion: ToolCompletionContext,
		result: AgentToolResult<unknown>,
	): Promise<void> {
		const execution = this.toolExecutionStates.get(completion.toolCallId);
		if (execution?.suspendedStep?.status !== 'resolved') return;

		execution.completedSteps = completion.completedSteps;
		const pendingBeforeCompletion = [...this.pendingRequests];
		this.toolExecutionStates.delete(completion.toolCallId);
		this.pendingRequests = this.pendingRequests.filter((request) => request.toolCallId !== completion.toolCallId);

		try {
			if (this.config.onCheckpoint) {
				const checkpoint = await this.checkpoint();
				const resultMessage = agentToolResultToPiMessage(completion.toolCallId, completion.toolName, result);
				checkpoint.messages.push(...piMessagesToCheckpoint([resultMessage]));
				await this.config.onCheckpoint(checkpoint, 'tool_completed');
			}
		} catch (error) {
			this.toolExecutionStates.set(completion.toolCallId, execution);
			this.pendingRequests = pendingBeforeCompletion;
			this.failLifecycle(error);
			return new Promise<void>(() => {});
		}
	}

	private failLifecycle(error: unknown): void {
		this.fatalLifecycleError = error;
		this.agent.abort();
		this.activeEventQueue?.close();
	}

	private rebuildAgentAfterLifecycleFailure(): void {
		const state = this.agent.state;
		this.agent = new Agent({
			initialState: {
				systemPrompt: state.systemPrompt,
				model: state.model,
				thinkingLevel: state.thinkingLevel,
				tools: state.tools,
				messages: state.messages,
				isStreaming: false,
				streamMessage: null,
				pendingToolCalls: new Set(),
			},
			streamFn: this.streamFn,
			steeringMode: 'one-at-a-time',
			followUpMode: 'one-at-a-time',
		});
	}

	private waitForResolution(suspensionId: SuspensionId): Promise<StepResumeData> {
		const execution = this.findExecutionBySuspensionId(suspensionId);
		const accepted = execution?.suspendedStep?.resumeData;
		if (accepted) return Promise.resolve(accepted);

		return new Promise((resolve, reject) => {
			this.suspensionResolvers.set(suspensionId, { resolve, reject });
		});
	}

	private getSuspendedExecution(): ToolExecutionState | undefined {
		return [...this.toolExecutionStates.values()].find((execution) => execution.suspendedStep !== undefined);
	}

	private findExecutionBySuspensionId(suspensionId: SuspensionId): ToolExecutionState | undefined {
		return [...this.toolExecutionStates.values()].find(
			(execution) => execution.suspendedStep?.suspensionId === suspensionId,
		);
	}

	private executionToPendingRequest(execution: ToolExecutionState): PendingRequestInfo {
		const suspended = execution.suspendedStep;
		if (!suspended) throw new Error(`Tool execution "${execution.toolCallId}" is not suspended`);

		return {
			suspensionId: suspended.suspensionId,
			toolCallId: execution.toolCallId,
			toolName: execution.toolName,
			stepId: suspended.stepId,
			type: suspended.request.type,
			request: this.suspensionRequestToData(suspended.request),
			suspendedAt: suspended.suspendedAt,
			deadline: suspended.deadline,
			status: suspended.status,
		};
	}

	private async persistLifecycle(reason: 'suspended' | 'resolution_accepted' | 'tool_completed'): Promise<void> {
		if (!this.config.onCheckpoint) return;
		await this.config.onCheckpoint(await this.checkpoint(), reason);
	}

	private async replayRestoredExecution(execution: ToolExecutionState): Promise<void> {
		const suspended = execution.suspendedStep;
		if (!suspended) throw new Error(`Tool execution "${execution.toolCallId}" is not suspended`);

		if (suspended.status === 'waiting') {
			try {
				await this.persistLifecycle('suspended');
			} catch (error) {
				this.failLifecycle(error);
				return new Promise<void>(() => {});
			}
			this._status = 'waiting';
			this.activeEventQueue?.push({ type: 'status', status: 'waiting', timestamp: Date.now() });
			this.activeEventQueue?.push({
				type: 'suspended',
				pendingRequests: [...this.pendingRequests],
				timestamp: Date.now(),
			});
			await this.waitForResolution(suspended.suspensionId);
		}

		const current = this.toolExecutionStates.get(execution.toolCallId);
		if (!current?.suspendedStep?.resumeData) {
			throw new Error(`Suspension "${suspended.suspensionId}" has no accepted resolution`);
		}

		if (!this.hasToolResult(execution.toolCallId)) {
			const tool = this.agent.state.tools.find((candidate) => candidate.name === execution.toolName);
			if (!tool) throw new Error(`Cannot replay missing tool "${execution.toolName}"`);
			const result = await this.executeRestoredTool(tool, execution);
			this.agent.appendMessage(agentToolResultToPiMessage(execution.toolCallId, execution.toolName, result));
		}

		const latest = this.toolExecutionStates.get(execution.toolCallId);
		if (latest?.suspendedStep?.status === 'waiting') return;
		if (latest) {
			const pendingBeforeCompletion = [...this.pendingRequests];
			this.toolExecutionStates.delete(execution.toolCallId);
			this.pendingRequests = [];
			try {
				await this.persistLifecycle('tool_completed');
			} catch (error) {
				this.toolExecutionStates.set(execution.toolCallId, latest);
				this.pendingRequests = pendingBeforeCompletion;
				throw error;
			}
		}
		await this.agent.continue();
	}

	private async executeRestoredTool(
		tool: PiAgentTool,
		execution: ToolExecutionState,
	): Promise<AgentToolResult<unknown>> {
		return tool.execute(execution.toolCallId, execution.input as never, this.abortController.signal);
	}

	private hasToolResult(toolCallId: string): boolean {
		return this.agent.state.messages.some(
			(message) => 'role' in message && message.role === 'toolResult' && message.toolCallId === toolCallId,
		);
	}

	private async clearCompletedToolExecutions(): Promise<void> {
		const cleared: ToolExecutionState[] = [];
		const pendingBeforeCompletion = [...this.pendingRequests];
		for (const [toolCallId, execution] of this.toolExecutionStates) {
			if (execution.suspendedStep?.status === 'resolved' && this.hasToolResult(toolCallId)) {
				this.toolExecutionStates.delete(toolCallId);
				cleared.push(execution);
			}
		}
		if (cleared.length === 0) return;
		this.pendingRequests = this.pendingRequests.filter((request) =>
			this.toolExecutionStates.has(request.toolCallId),
		);
		try {
			await this.persistLifecycle('tool_completed');
		} catch (error) {
			for (const execution of cleared) this.toolExecutionStates.set(execution.toolCallId, execution);
			this.pendingRequests = pendingBeforeCompletion;
			throw error;
		}
	}

	private suspensionRequestToData(request: SuspensionRequest): SuspensionRequestData {
		switch (request.type) {
			case 'user_input':
				return {
					type: 'user_input',
					prompt: request.request.prompt,
					schema: request.request.schema,
					timeout: request.request.timeout,
				};
			case 'approval':
				return {
					type: 'approval',
					action: request.request.action,
					description: request.request.description,
					details: request.request.details,
					timeout: request.request.timeout,
				};
			case 'event':
				return {
					type: 'event',
					eventName: request.eventName,
					timeout: request.options?.timeout,
				};
			case 'sleep':
				return {
					type: 'sleep',
					durationMs: request.durationMs,
					wakeAt: request.wakeAt,
				};
		}
	}

	private extractErrorFromMessage(msg: AgentMessage): string {
		// pi-ai stores the error string in errorMessage on AssistantMessage
		if ('errorMessage' in msg && typeof msg.errorMessage === 'string' && msg.errorMessage) {
			return msg.errorMessage;
		}
		// Fallback: check content array for any text
		if ('content' in msg && Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === 'text' && part.text) {
					return part.text;
				}
			}
		}
		return 'Unknown error (no details in error response)';
	}

	private getLastAssistantMessage(): string | undefined {
		const messages = this.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg && 'role' in msg && msg.role === 'assistant') {
				const content = msg.content;
				if (Array.isArray(content)) {
					for (const part of content) {
						if (part.type === 'text') {
							return part.text;
						}
					}
				}
			}
		}
		return undefined;
	}
}

/**
 * Map from our provider types to pi-ai API types.
 */
const PROVIDER_TO_API: Record<string, Api> = {
	anthropic: 'anthropic-messages',
	openai: 'openai-completions',
	google: 'google-generative-ai',
};

/**
 * Create a custom model configuration for use with custom endpoints.
 */
function createCustomModel(
	modelId: string,
	providerType: string,
	userProviderName: string,
	baseUrl: string,
	supportsReasoning: boolean,
): Model<Api> {
	const api = PROVIDER_TO_API[providerType];
	if (!api) {
		throw new Error(
			`Unsupported provider type "${providerType}". Supported: ${Object.keys(PROVIDER_TO_API).join(', ')}`,
		);
	}

	return {
		id: modelId,
		name: modelId,
		api,
		provider: `custom:${userProviderName}`,
		baseUrl,
		reasoning: supportsReasoning,
		input: ['text', 'image'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
	} as Model<Api>;
}

/**
 * Create a Pi agent instance.
 */
export async function createPiAgentInstance(
	config: AdapterCreateConfig,
	options: {
		providerType: 'anthropic' | 'openai' | 'google';
		userProviderName: string;
		modelId: string;
		apiKey?: string | (() => Promise<string | undefined>);
		thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
		baseUrl?: string;
	},
): Promise<PiAgentInstance> {
	const model = resolveModel(
		options.providerType,
		options.userProviderName,
		options.modelId,
		options.baseUrl,
		options.thinkingLevel,
	);

	// Use injected system context directly if provided (new injector-based approach)
	// Fall back to deprecated buildSystemPromptWithTask for backwards compatibility
	let systemPrompt: string;
	if (config.contextInjection?.systemContext) {
		systemPrompt = config.contextInjection.systemContext;
	} else {
		// Deprecated: Build system prompt manually when no injected context is provided
		systemPrompt = await buildSystemPromptWithTask(config.guidance, config.task, config.skills, undefined);
	}

	return new PiAgentInstance(config, model, systemPrompt, {
		apiKey: options.apiKey,
		thinkingLevel: options.thinkingLevel,
	});
}

/**
 * Resolve a model from provider and model ID.
 */
function resolveModel(
	providerType: string,
	userProviderName: string,
	modelId: string,
	baseUrl?: string,
	thinkingLevel?: string,
): Model<Api> {
	if (baseUrl) {
		// Custom endpoint - create a custom model configuration
		const supportsReasoning = thinkingLevel !== undefined && thinkingLevel !== 'off';
		return createCustomModel(modelId, providerType, userProviderName, baseUrl, supportsReasoning);
	}

	// Standard provider - look up from known models
	const models = getModels(providerType as 'anthropic' | 'openai' | 'google');
	const foundModel = models.find((m) => m.id === modelId || m.name === modelId);

	if (!foundModel) {
		throw new Error(`Model "${modelId}" not found for provider "${providerType}"`);
	}
	return foundModel as Model<Api>;
}

/**
 * Create a Pi agent instance from a checkpoint.
 * This restores the agent with its previous message history.
 */
export async function createPiAgentInstanceFromCheckpoint(
	checkpoint: AgentCheckpoint,
	config: AdapterCreateConfig,
	options: PiAdapterOptions,
): Promise<PiAgentInstance> {
	// Transform checkpoint messages back to Pi format
	const checkpointPiMessages = checkpointToPiMessages(checkpoint.messages);

	// Append resume messages from context injection if present
	// These go after checkpoint messages but before the new user message (which is added later)
	let piMessages = checkpointPiMessages;
	const hasSuspendedExecution = checkpoint.toolExecutions.some((execution) => execution.suspendedStep !== undefined);
	if (
		!hasSuspendedExecution &&
		config.contextInjection?.resumeMessages &&
		config.contextInjection.resumeMessages.length > 0
	) {
		const resumePiMessages = checkpointToPiMessages(config.contextInjection.resumeMessages);
		piMessages = [...checkpointPiMessages, ...resumePiMessages];
	}

	// Resolve the model using the adapter's API model ID
	const model = resolveModel(
		options.providerType,
		options.userProviderName,
		options.modelId,
		options.baseUrl,
		options.thinkingLevel,
	);

	// Use injected system context directly if provided (new injector-based approach)
	// Fall back to deprecated buildSystemPromptWithTask for backwards compatibility
	// Note: For resume/continue, we typically rebuild the system prompt fresh
	let systemPrompt: string;
	if (config.contextInjection?.systemContext) {
		systemPrompt = config.contextInjection.systemContext;
	} else {
		// Deprecated: Build system prompt manually when no injected context is provided
		systemPrompt = await buildSystemPromptWithTask(config.guidance, config.task, config.skills, undefined);
	}

	// Create restore options from checkpoint
	const restoreOptions: RestoreOptions = {
		messages: piMessages,
		sessionId: checkpoint.session.id,
		createdAt: checkpoint.session.createdAt,
		turnCount: checkpoint.session.metrics.turns,
		provider: checkpoint.adapterConfig.provider,
		modelId: checkpoint.adapterConfig.model,
		toolExecutions: checkpoint.toolExecutions,
	};

	return new PiAgentInstance(config, model, systemPrompt, {
		apiKey: options.apiKey,
		thinkingLevel: options.thinkingLevel,
		restoreOptions,
	});
}
