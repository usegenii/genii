/**
 * Pi agent instance implementation.
 */

import type {
	AgentMessage,
	AgentToolResult,
	AgentEvent as PiAgentEvent,
	AgentTool as PiAgentTool,
	StreamFn,
} from '@mariozechner/pi-agent-core';
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
	ToolExecutionResult,
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
	type ToolStartContext,
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
	private lifecycleTail: Promise<void> = Promise.resolve();
	private activeEventQueue: AsyncEventQueue<AgentEvent> | null = null;
	private fatalLifecycleError: unknown = null;
	private lifecycleRecoveryMessageCount: number | null = null;
	private lifecycleGeneration = 0;
	private aborted = false;
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
			}
			this.refreshPendingRequests();
			if (this.areAllIncompleteExecutionsParked()) {
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

		// Build Pi tools from our tools (use empty registry if not provided).
		// Each wrapper generation is fenced so callbacks from an aborted replay
		// cannot mutate the next retry's durable state.
		const piTools = this.createPiTools(this.lifecycleGeneration);

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
			// Pi starts wrappers concurrently but publishes their messages in source order.
			toolExecution: 'parallel',
		});

		// Queue initial input
		if (config.input) {
			this.inputQueue.push(config.input);
		}
	}

	async *run(): AsyncIterable<AgentEvent> {
		if (this.aborted) return;
		if (this.fatalLifecycleError && this.toolExecutionStates.size > 0) {
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
			const hasRestoredBatch = this.toolExecutionStates.size > 0;
			if (initialInput?.message || hasRestoredBatch) {
				if (initialInput?.message) {
					this.logger.debug({ messageLength: initialInput.message.length }, 'Processing initial input');
				}

				const eventQueue = new AsyncEventQueue<AgentEvent>();
				this.activeEventQueue = eventQueue;
				const lifecycleGeneration = this.lifecycleGeneration;
				const unsubscribe = this.agent.subscribe(async (piEvent) => {
					this.logger.debug({ piEventType: piEvent.type }, 'Pi event received');
					if (piEvent.type === 'turn_end') this.turnCount++;
					await this.handlePiLifecycleEvent(piEvent, lifecycleGeneration);
					const mapped = mapPiEvent(piEvent, this.toolCallTimes);
					if (Array.isArray(mapped)) {
						for (const event of mapped) eventQueue.push(event);
					} else if (mapped) {
						eventQueue.push(mapped);
					}
				});

				let operationError: unknown = null;
				const operation = initialInput?.message
					? this.agent.prompt(initialInput.message)
					: this.replayRestoredBatch(lifecycleGeneration);
				const operationPromise = operation
					.catch((error) => {
						operationError = error;
					})
					.finally(() => {
						unsubscribe();
						if (this.activeEventQueue === eventQueue) this.activeEventQueue = null;
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

				if (this.aborted) {
					unsubscribe();
					this.activeEventQueue = null;
					return;
				}
				if (this.fatalLifecycleError) {
					unsubscribe();
					this.activeEventQueue = null;
					throw this.fatalLifecycleError;
				}
				await operationPromise;
				if (operationError) throw operationError;

				const lastMsg = this.agent.state.messages[this.agent.state.messages.length - 1];
				if (lastMsg && 'stopReason' in lastMsg && lastMsg.stopReason === 'error') {
					throw new Error(`LLM returned error response: ${this.extractErrorFromMessage(lastMsg)}`);
				}
			} else {
				this.logger.warn('No initial input or suspended tool invocation — skipping LLM call');
			}

			if (this.aborted) return;

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
			if (this.aborted) {
				this._status = 'aborted';
				return;
			}
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
		if (this.aborted) return;
		this.aborted = true;
		this.lifecycleGeneration++;
		this.tracker = createToolExecutionTracker();
		this._status = 'aborted';
		this.pendingRequests = [];
		this.abortController.abort();
		this.agent.abort();
		for (const resolver of this.suspensionResolvers.values()) {
			resolver.reject(new Error('Agent aborted while waiting for a suspension resolution'));
		}
		this.suspensionResolvers.clear();
		this.activeEventQueue?.close();
		void this.serializeLifecycle(() => {
			this.toolExecutionStates.clear();
			this.tracker.executions.clear();
		}).catch((error) => {
			this.logger.error({ error }, 'Failed to clear aborted tool batch state');
		});
	}

	async checkpoint(): Promise<InstanceCheckpoint> {
		return this.serializeLifecycle(() => this.buildCheckpoint());
	}

	private buildCheckpoint(): InstanceCheckpoint {
		this.synchronizeTrackedSteps();
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
			// A batch enters the durable model once any registered call suspends.
			// Before that boundary, runtime-only call records are intentionally omitted.
			toolExecutions: this.isDurableBatch() ? structuredClone(this.getOrderedToolExecutions()) : [],
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
		const lifecycleGeneration = this.lifecycleGeneration;

		await this.serializeLifecycle(async () => {
			this.assertLifecycleActive(lifecycleGeneration);
			const uniqueResolutions = new Map<SuspensionId, SuspensionResolution>();
			const accepted: Array<{
				execution: ToolExecutionState;
				resolution: SuspensionResolution;
				resumeData: StepResumeData;
			}> = [];

			for (const pendingResolution of resolutions) {
				const resolution = pendingResolution as SuspensionResolution;
				const duplicate = uniqueResolutions.get(resolution.suspensionId);
				if (duplicate) {
					if (isIdenticalResolution(duplicate, resolution)) continue;
					throw new Error(`Suspension "${resolution.suspensionId}" has conflicting requested resolutions`);
				}
				uniqueResolutions.set(resolution.suspensionId, resolution);
			}

			for (const resolution of uniqueResolutions.values()) {
				const execution = this.findExecutionBySuspensionId(resolution.suspensionId);
				if (!execution?.suspendedStep) {
					throw new Error(`Suspension "${resolution.suspensionId}" is stale or does not exist`);
				}

				const suspendedStep = execution.suspendedStep;
				if (suspendedStep.status === 'resolved') {
					if (suspendedStep.resolution && isIdenticalResolution(suspendedStep.resolution, resolution)) {
						continue;
					}
					throw new Error(`Suspension "${resolution.suspensionId}" already has a conflicting resolution`);
				}
				if (execution.result) {
					throw new Error(`Suspension "${resolution.suspensionId}" is stale or does not exist`);
				}

				accepted.push({
					execution,
					resolution,
					resumeData: normalizeSuspensionResolution(suspendedStep.stepId, suspendedStep.request, resolution),
				});
			}

			if (accepted.length === 0) return;
			for (const { execution, resolution, resumeData } of accepted) {
				const suspendedStep = execution.suspendedStep as NonNullable<ToolExecutionState['suspendedStep']>;
				suspendedStep.status = 'resolved';
				suspendedStep.resolution = resolution;
				suspendedStep.resumeData = resumeData;
			}

			try {
				await this.persistLifecycleNow('resolution_accepted');
				this.assertLifecycleActive(lifecycleGeneration);
				// Keep the public pending view at the last durable state until the
				// accepted resolution checkpoint has committed.
				this.refreshPendingRequests();
			} catch (error) {
				for (const { execution } of accepted) {
					const suspendedStep = execution.suspendedStep as NonNullable<ToolExecutionState['suspendedStep']>;
					suspendedStep.status = 'waiting';
					suspendedStep.resolution = undefined;
					suspendedStep.resumeData = undefined;
				}
				if (!this.aborted) this.refreshPendingRequests();
				throw error;
			}

			for (const { resolution, resumeData } of accepted) {
				const resolver = this.suspensionResolvers.get(resolution.suspensionId);
				if (resolver) {
					resolver.resolve(resumeData);
					this.suspensionResolvers.delete(resolution.suspensionId);
				}
			}

			if (this.hasWaitingSuspensions()) {
				this.publishSuspensionState();
			} else {
				this._status = 'running';
				this.activeEventQueue?.push({ type: 'status', status: 'running', timestamp: Date.now() });
			}
		});
	}

	private async handleToolStart(start: ToolStartContext, lifecycleGeneration: number): Promise<void> {
		this.assertNotAborted();
		if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return this.parkFailedGeneration();
		try {
			await this.serializeLifecycle(() => {
				this.assertLifecycleActive(lifecycleGeneration);
				const execution = this.toolExecutionStates.get(start.toolCallId);
				if (execution) {
					// Pi announces every source call before preflight. The registered
					// wrapper then replaces raw arguments with its validated input.
					execution.toolName = start.toolName;
					execution.input = start.input;
					return;
				}
				this.toolExecutionStates.set(start.toolCallId, {
					toolName: start.toolName,
					toolCallId: start.toolCallId,
					input: start.input,
					sourceOrder: this.getToolSourceOrder(start.toolCallId),
					completedSteps: [],
				});
			});
		} catch (error) {
			if (this.aborted) throw error;
			if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return this.parkFailedGeneration();
			throw error;
		}
	}

	private async handlePiToolCompletion(
		completion: Extract<PiAgentEvent, { type: 'tool_execution_end' }>,
		lifecycleGeneration: number,
	): Promise<void> {
		if (this.aborted) return;
		if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return this.parkFailedGeneration();
		try {
			await this.serializeLifecycle(async () => {
				this.assertLifecycleActive(lifecycleGeneration);
				const execution = this.toolExecutionStates.get(completion.toolCallId) ?? {
					toolName: completion.toolName,
					toolCallId: completion.toolCallId,
					input: undefined,
					sourceOrder: this.getToolSourceOrder(completion.toolCallId),
					completedSteps: [],
				};

				// Registered wrappers persist their result in onComplete before Pi
				// emits this event. Immediate preflight failures never enter a wrapper,
				// so retain their finalized artifact here for durable batch recovery.
				if (execution.result) return;
				execution.result = this.storeToolResult(completion.result, completion.isError);
				this.toolExecutionStates.set(completion.toolCallId, execution);
				this.refreshPendingRequests();

				if (this.isDurableBatch() && this.hasOtherIncompleteExecution(completion.toolCallId)) {
					await this.persistLifecycleNow('tool_completed');
					this.assertLifecycleActive(lifecycleGeneration);
				}
				if (this.hasWaitingSuspensions() && this.areAllIncompleteExecutionsParked()) {
					this.publishSuspensionState();
				}
			});
		} catch (error) {
			if (this.aborted) return;
			if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return this.parkFailedGeneration();
			this.failLifecycle(error, lifecycleGeneration);
			return this.parkFailedGeneration();
		}
	}

	private async handleSuspension(
		suspension: ToolSuspensionContext,
		lifecycleGeneration: number,
	): Promise<StepResumeData> {
		this.assertNotAborted();
		if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return this.parkFailedGeneration();
		const suspensionId = createSuspensionId(suspension.toolCallId, suspension.stepId);
		try {
			await this.serializeLifecycle(async () => {
				this.assertLifecycleActive(lifecycleGeneration);
				const suspendedAt = Date.now();
				const execution = this.toolExecutionStates.get(suspension.toolCallId) ?? {
					toolName: suspension.toolName,
					toolCallId: suspension.toolCallId,
					input: suspension.input,
					sourceOrder: this.getToolSourceOrder(suspension.toolCallId),
					completedSteps: [],
				};
				execution.completedSteps = suspension.completedSteps;
				execution.suspendedStep = {
					suspensionId,
					stepId: suspension.stepId,
					request: suspension.request,
					suspendedAt,
					deadline: getSuspensionDeadline(suspension.request, suspendedAt),
					status: 'waiting',
				};
				execution.result = undefined;
				this.toolExecutionStates.set(suspension.toolCallId, execution);
				await this.persistLifecycleNow('suspended');
				this.assertLifecycleActive(lifecycleGeneration);
				this.refreshPendingRequests();
				this.publishSuspensionState();
			});
		} catch (error) {
			if (this.aborted) throw error;
			if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return this.parkFailedGeneration();
			this.failLifecycle(error, lifecycleGeneration);
			return this.parkFailedGeneration();
		}

		return this.waitForResolution(suspensionId);
	}

	private async handleToolCompletion(
		completion: ToolCompletionContext,
		result: AgentToolResult<unknown>,
		lifecycleGeneration: number,
	): Promise<void> {
		this.assertNotAborted();
		if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return this.parkFailedGeneration();
		try {
			await this.serializeLifecycle(async () => {
				this.assertLifecycleActive(lifecycleGeneration);
				const execution = this.toolExecutionStates.get(completion.toolCallId) ?? {
					toolName: completion.toolName,
					toolCallId: completion.toolCallId,
					input: completion.input,
					sourceOrder: this.getToolSourceOrder(completion.toolCallId),
					completedSteps: [],
				};
				execution.completedSteps = completion.completedSteps;
				execution.result = this.storeToolResult(result);
				this.toolExecutionStates.set(completion.toolCallId, execution);
				this.refreshPendingRequests();

				// Persist partial batch progress while another wrapper is still
				// outstanding. The final call is committed at Pi's turn barrier.
				if (this.isDurableBatch() && this.hasOtherIncompleteExecution(completion.toolCallId)) {
					await this.persistLifecycleNow('tool_completed');
					this.assertLifecycleActive(lifecycleGeneration);
				}
				if (this.hasWaitingSuspensions() && this.areAllIncompleteExecutionsParked()) {
					this.publishSuspensionState();
				}
			});
		} catch (error) {
			if (this.aborted) throw error;
			if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return this.parkFailedGeneration();
			this.failLifecycle(error, lifecycleGeneration);
			return this.parkFailedGeneration();
		}
	}

	private async handlePiLifecycleEvent(event: PiAgentEvent, lifecycleGeneration: number): Promise<void> {
		if (this.aborted) return;
		if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return this.parkFailedGeneration();
		try {
			if (event.type === 'tool_execution_start') {
				await this.handleToolStart(
					{
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						input: event.args,
					},
					lifecycleGeneration,
				);
				return;
			}
			if (event.type === 'tool_execution_end') {
				await this.handlePiToolCompletion(event, lifecycleGeneration);
				return;
			}
			if (event.type !== 'turn_end' || event.toolResults.length === 0) return;
			await this.handleToolBatchBarrier(event.toolResults, lifecycleGeneration);
		} catch (error) {
			if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return this.parkFailedGeneration();
			this.failLifecycle(error, lifecycleGeneration);
			throw error;
		}
	}

	private async handleToolBatchBarrier(
		toolResults: Extract<PiAgentEvent, { type: 'turn_end' }>['toolResults'],
		lifecycleGeneration: number,
	): Promise<void> {
		await this.serializeLifecycle(async () => {
			this.assertLifecycleActive(lifecycleGeneration);
			const toolCallIds = new Set(toolResults.map((result) => result.toolCallId));
			const batchExecutions = this.getOrderedToolExecutions().filter((execution) =>
				toolCallIds.has(execution.toolCallId),
			);
			if (batchExecutions.length === 0) return;

			const durable = batchExecutions.some((execution) => execution.suspendedStep !== undefined);
			for (const resultMessage of toolResults) {
				const execution = this.toolExecutionStates.get(resultMessage.toolCallId);
				if (execution && !execution.result) {
					execution.result = this.storeToolResult(
						{ content: resultMessage.content, details: resultMessage.details },
						resultMessage.isError,
					);
				}
			}

			if (!durable) {
				for (const execution of batchExecutions) {
					this.toolExecutionStates.delete(execution.toolCallId);
				}
				this.refreshPendingRequests();
				return;
			}
			// Pi has already appended every result message in assistant source
			// order. Keep the completed per-call records in this checkpoint as
			// the durable marker that one model continuation is still pending.
			await this.persistLifecycleNow('tool_completed');
			for (const execution of batchExecutions) {
				this.toolExecutionStates.delete(execution.toolCallId);
			}
			this.refreshPendingRequests();
		});
	}

	private failLifecycle(error: unknown, lifecycleGeneration: number): void {
		if (!this.isCurrentLifecycleGeneration(lifecycleGeneration) || this.aborted) return;
		if (this.lifecycleRecoveryMessageCount === null) {
			this.lifecycleRecoveryMessageCount = this.agent.state.messages.length;
		}
		this.fatalLifecycleError ??= error;
		this.lifecycleGeneration++;
		this.tracker = createToolExecutionTracker();
		this.abortController.abort();
		this.agent.abort();
		for (const resolver of this.suspensionResolvers.values()) {
			resolver.reject(new Error('Tool lifecycle generation failed before suspension resolution'));
		}
		this.suspensionResolvers.clear();
		this.activeEventQueue?.close();
	}

	private rebuildAgentAfterLifecycleFailure(): void {
		const state = this.agent.state;
		const messages =
			this.lifecycleRecoveryMessageCount === null
				? state.messages
				: state.messages.slice(0, this.lifecycleRecoveryMessageCount);
		this.abortController = new AbortController();
		this.tracker = createToolExecutionTracker();
		this.agent = new Agent({
			initialState: {
				systemPrompt: state.systemPrompt,
				model: state.model,
				thinkingLevel: state.thinkingLevel,
				tools: this.createPiTools(this.lifecycleGeneration),
				messages,
			},
			streamFn: this.streamFn,
			steeringMode: 'one-at-a-time',
			followUpMode: 'one-at-a-time',
			toolExecution: 'parallel',
		});
		this.lifecycleRecoveryMessageCount = null;
	}

	private waitForResolution(suspensionId: SuspensionId): Promise<StepResumeData> {
		if (this.aborted) {
			return Promise.reject(new Error('Agent aborted while waiting for a suspension resolution'));
		}
		const execution = this.findExecutionBySuspensionId(suspensionId);
		const accepted = execution?.suspendedStep?.resumeData;
		if (accepted) return Promise.resolve(accepted);

		return new Promise((resolve, reject) => {
			this.suspensionResolvers.set(suspensionId, { resolve, reject });
		});
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

	private async persistLifecycleNow(reason: 'suspended' | 'resolution_accepted' | 'tool_completed'): Promise<void> {
		if (!this.config.onCheckpoint) return;
		await this.config.onCheckpoint(this.buildCheckpoint(), reason);
	}

	private async replayRestoredBatch(lifecycleGeneration: number): Promise<void> {
		try {
			this.assertLifecycleActive(lifecycleGeneration);
			if (this.hasWaitingSuspensions()) {
				await this.serializeLifecycle(async () => {
					this.assertLifecycleActive(lifecycleGeneration);
					await this.persistLifecycleNow('suspended');
					this.assertLifecycleActive(lifecycleGeneration);
					this.refreshPendingRequests();
					this.publishSuspensionState();
				});
			}

			const executions = this.getOrderedToolExecutions();
			await Promise.all(executions.map((execution) => this.replayToolExecution(execution)));
			this.assertLifecycleActive(lifecycleGeneration);
			await this.commitRestoredBatch(lifecycleGeneration);
			this.assertLifecycleActive(lifecycleGeneration);
			await this.agent.continue();
		} catch (error) {
			if (!this.aborted && this.isCurrentLifecycleGeneration(lifecycleGeneration)) {
				this.failLifecycle(error, lifecycleGeneration);
			}
			throw error;
		}
	}

	private async replayToolExecution(execution: ToolExecutionState): Promise<void> {
		let current = this.toolExecutionStates.get(execution.toolCallId);
		if (!current || current.result) return;

		const suspended = current.suspendedStep;
		if (suspended?.status === 'waiting') {
			await this.waitForResolution(suspended.suspensionId);
		}
		current = this.toolExecutionStates.get(execution.toolCallId);
		if (!current || current.result) return;
		if (current.suspendedStep && !current.suspendedStep.resumeData) {
			throw new Error(`Suspension "${current.suspendedStep.suspensionId}" has no accepted resolution`);
		}

		const tool = this.agent.state.tools.find((candidate) => candidate.name === current?.toolName);
		if (!tool) throw new Error(`Cannot replay missing tool "${current.toolName}"`);
		await this.executeRestoredTool(tool, current);
	}

	private async commitRestoredBatch(lifecycleGeneration: number): Promise<void> {
		await this.serializeLifecycle(async () => {
			this.assertLifecycleActive(lifecycleGeneration);
			const executions = this.getOrderedToolExecutions();
			for (const execution of executions) {
				if (!execution.result) {
					throw new Error(`Restored tool "${execution.toolCallId}" did not produce a result`);
				}
			}

			const restoredResults = new Map(
				executions.map((execution) => [
					execution.toolCallId,
					agentToolResultToPiMessage(
						execution.toolCallId,
						execution.toolName,
						this.restoreToolResult(execution.result as ToolExecutionResult),
						(execution.result as ToolExecutionResult).isError,
					),
				]),
			);
			const trackedToolCallIds = new Set(restoredResults.keys());
			const assistantBatch = this.findAssistantToolBatch(trackedToolCallIds);
			if (assistantBatch) {
				const batchToolCallIds = new Set(assistantBatch.toolCallIds);
				const messagesAfterAssistant = this.agent.state.messages.slice(assistantBatch.messageIndex + 1);
				const retainedResults = new Map(
					messagesAfterAssistant.flatMap((message) =>
						'role' in message && message.role === 'toolResult' && batchToolCallIds.has(message.toolCallId)
							? [[message.toolCallId, message] as const]
							: [],
					),
				);
				const orderedResults = assistantBatch.toolCallIds.flatMap((toolCallId) => {
					const result = restoredResults.get(toolCallId) ?? retainedResults.get(toolCallId);
					return result ? [result] : [];
				});
				for (const execution of executions) {
					if (!batchToolCallIds.has(execution.toolCallId)) {
						const restoredResult = restoredResults.get(execution.toolCallId);
						if (restoredResult) orderedResults.push(restoredResult);
					}
				}
				const remainingMessages = messagesAfterAssistant.filter(
					(message) =>
						!(
							'role' in message &&
							message.role === 'toolResult' &&
							batchToolCallIds.has(message.toolCallId)
						),
				);
				this.agent.state.messages = [
					...this.agent.state.messages.slice(0, assistantBatch.messageIndex + 1),
					...orderedResults,
					...remainingMessages,
				];
			} else {
				const messagesWithoutTrackedResults = this.agent.state.messages.filter(
					(message) =>
						!('role' in message) ||
						message.role !== 'toolResult' ||
						!trackedToolCallIds.has(message.toolCallId),
				);
				this.agent.state.messages = [...messagesWithoutTrackedResults, ...restoredResults.values()];
			}

			// Persist all completed call records as a continuation-pending
			// marker before allowing the next model request to start.
			await this.persistLifecycleNow('tool_completed');
			for (const execution of executions) {
				this.toolExecutionStates.delete(execution.toolCallId);
				this.tracker.executions.delete(execution.toolCallId);
			}
			this.refreshPendingRequests();
		});
	}

	private findAssistantToolBatch(
		trackedToolCallIds: ReadonlySet<string>,
	): { messageIndex: number; toolCallIds: string[] } | undefined {
		for (let messageIndex = this.agent.state.messages.length - 1; messageIndex >= 0; messageIndex--) {
			const message = this.agent.state.messages[messageIndex];
			if (!message || !('role' in message) || message.role !== 'assistant' || !Array.isArray(message.content)) {
				continue;
			}
			const toolCallIds = message.content.flatMap((part) => (part.type === 'toolCall' ? [part.id] : []));
			if (toolCallIds.some((toolCallId) => trackedToolCallIds.has(toolCallId))) {
				return { messageIndex, toolCallIds };
			}
		}
		return undefined;
	}

	private async executeRestoredTool(
		tool: PiAgentTool,
		execution: ToolExecutionState,
	): Promise<AgentToolResult<unknown>> {
		return tool.execute(execution.toolCallId, execution.input as never, this.abortController.signal);
	}

	private createPiTools(lifecycleGeneration: number): PiAgentTool[] {
		const toolRegistry = this.config.tools ?? createToolRegistry();
		return buildPiTools(
			toolRegistry.all(),
			this.id,
			this.config.guidance,
			this.abortController.signal,
			this.tracker,
			// Progress callback
			(_toolCallId, _toolName, _progress) => {
				// Progress is emitted through events
			},
			// Suspension callback
			(suspension) => this.handleSuspension(suspension, lifecycleGeneration),
			// Get resume data
			(toolCallId) =>
				this.isCurrentLifecycleGeneration(lifecycleGeneration)
					? this.toolExecutionStates.get(toolCallId)
					: undefined,
			// Persist the real tool result before Pi begins its next model turn.
			(completion, result) => this.handleToolCompletion(completion, result, lifecycleGeneration),
			// Register each call before user code mutates its isolated step state.
			(execution) => this.handleToolStart(execution, lifecycleGeneration),
		);
	}

	private storeToolResult(result: AgentToolResult<unknown>, isError = false): ToolExecutionResult {
		return {
			content: result.content,
			details: result.details,
			terminate: result.terminate,
			isError,
			completedAt: Date.now(),
		};
	}

	private restoreToolResult(result: ToolExecutionResult): AgentToolResult<unknown> {
		return {
			content: result.content,
			details: result.details,
			terminate: result.terminate,
		};
	}

	private serializeLifecycle<T>(operation: () => Promise<T> | T): Promise<T> {
		const result = this.lifecycleTail.then(operation);
		this.lifecycleTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private assertNotAborted(): void {
		if (this.aborted) {
			throw new Error('Agent aborted during tool lifecycle transition');
		}
	}

	private assertLifecycleActive(lifecycleGeneration: number): void {
		this.assertNotAborted();
		if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) {
			throw new Error('Tool lifecycle generation is no longer active');
		}
	}

	private isCurrentLifecycleGeneration(lifecycleGeneration: number): boolean {
		return lifecycleGeneration === this.lifecycleGeneration;
	}

	private parkFailedGeneration<T>(): Promise<T> {
		return new Promise<T>(() => {});
	}

	private synchronizeTrackedSteps(): void {
		for (const [toolCallId, tracked] of this.tracker.executions) {
			const execution = this.toolExecutionStates.get(toolCallId);
			if (execution && !execution.result) {
				execution.completedSteps = tracked.stepContext.getCompletedSteps();
			}
		}
	}

	private refreshPendingRequests(): void {
		this.pendingRequests = this.getOrderedToolExecutions()
			.filter((execution) => execution.suspendedStep !== undefined && execution.result === undefined)
			.map((execution) => this.executionToPendingRequest(execution));
	}

	private hasWaitingSuspensions(): boolean {
		return [...this.toolExecutionStates.values()].some(
			(execution) => execution.result === undefined && execution.suspendedStep?.status === 'waiting',
		);
	}

	private areAllIncompleteExecutionsParked(): boolean {
		let hasIncompleteExecution = false;
		for (const execution of this.toolExecutionStates.values()) {
			if (execution.result) continue;
			hasIncompleteExecution = true;
			if (execution.suspendedStep?.status !== 'waiting') return false;
		}
		return hasIncompleteExecution;
	}

	private isDurableBatch(): boolean {
		return [...this.toolExecutionStates.values()].some((execution) => execution.suspendedStep !== undefined);
	}

	private hasOtherIncompleteExecution(toolCallId: string): boolean {
		return [...this.toolExecutionStates.values()].some(
			(execution) => execution.toolCallId !== toolCallId && execution.result === undefined,
		);
	}

	private getOrderedToolExecutions(): ToolExecutionState[] {
		return [...this.toolExecutionStates.values()].sort(
			(left, right) =>
				(left.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (right.sourceOrder ?? Number.MAX_SAFE_INTEGER),
		);
	}

	private getToolSourceOrder(toolCallId: string): number {
		for (let index = this.agent.state.messages.length - 1; index >= 0; index--) {
			const message = this.agent.state.messages[index];
			if (!message || !('role' in message) || message.role !== 'assistant' || !Array.isArray(message.content)) {
				continue;
			}
			const toolCalls = message.content.filter((part) => part.type === 'toolCall');
			const sourceOrder = toolCalls.findIndex((part) => part.id === toolCallId);
			if (sourceOrder >= 0) return sourceOrder;
		}
		return this.toolExecutionStates.size;
	}

	private publishSuspensionState(): void {
		const status = this.areAllIncompleteExecutionsParked() ? 'waiting' : 'running';
		if (this._status !== status) {
			this._status = status;
			this.activeEventQueue?.push({ type: 'status', status, timestamp: Date.now() });
		}
		this.activeEventQueue?.push({
			type: 'suspended',
			pendingRequests: [...this.pendingRequests],
			timestamp: Date.now(),
		});
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
