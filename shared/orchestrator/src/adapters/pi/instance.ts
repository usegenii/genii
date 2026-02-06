/**
 * Pi agent instance implementation.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { Agent } from '@mariozechner/pi-agent-core';
import type { Api, Message, Model } from '@mariozechner/pi-ai';
import { getModels, streamSimple } from '@mariozechner/pi-ai';
import type { AgentEvent, PendingRequestInfo, PendingResolution, SuspensionRequestData } from '../../events/types';
import type { AgentCheckpoint, InstanceCheckpoint, ToolExecutionState } from '../../snapshot/types';
import { createToolRegistry } from '../../tools/registry';
import { isSuspensionError } from '../../tools/suspension';
import type { SuspensionRequest } from '../../tools/types';
import type { AgentInput, AgentSessionId } from '../../types/core';
import { generateAgentSessionId } from '../../types/core';
import type { AdapterCreateConfig, AgentInstance, AgentInstanceStatus } from '../types';
import { type Logger, noopLogger } from '../../types/logger';
import { mapPiEvent } from './events';
import {
	buildPiTools,
	buildSystemPromptWithTask,
	createToolExecutionTracker,
	type ToolExecutionTracker,
} from './guidance';
import { checkpointToPiMessages, piMessagesToCheckpoint } from './messages';
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
}

/**
 * Pi agent instance.
 */
export class PiAgentInstance implements AgentInstance {
	readonly id: string;
	private agent: Agent;
	private config: AdapterCreateConfig;
	private _status: AgentInstanceStatus = 'idle';
	private pendingRequests: PendingRequestInfo[] = [];
	private pendingResolutions = new Map<string, PendingResolution>();
	private abortController = new AbortController();
	private toolCallTimes = new Map<string, number>();
	private toolExecutionStates = new Map<string, ToolExecutionState>();
	private tracker: ToolExecutionTracker;
	private pausePromise: Promise<void> | null = null;
	private pauseResolve: (() => void) | null = null;
	private suspensionResolvers = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: unknown) => void }
	>();
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
			(toolCallId, toolName, stepId, request) => {
				this.handleSuspension(toolCallId, toolName, stepId, request);
			},
			// Get resume data
			(toolCallId) => this.toolExecutionStates.get(toolCallId),
		);

		// Get initial messages - either from restore or empty
		const initialMessages = options.restoreOptions?.messages ?? [];

		// Create the Pi Agent
		this.agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: this.thinkingLevel,
				tools: piTools,
				messages: initialMessages as AgentMessage[],
				isStreaming: false,
				streamMessage: null,
				pendingToolCalls: new Set(),
			},
			streamFn: async (...args) => {
				// Get API key if we have a getter
				if (this.apiKeyGetter) {
					const apiKey = await this.apiKeyGetter();
					if (apiKey) {
						args[2] = { ...args[2], apiKey };
					}
				}
				return streamSimple(...args);
			},
			steeringMode: 'one-at-a-time',
			followUpMode: 'one-at-a-time',
		});

		// Queue initial input
		if (config.input) {
			this.inputQueue.push(config.input);
		}
	}

	async *run(): AsyncIterable<AgentEvent> {
		this._status = 'running';
		this.startTime = Date.now();

		yield {
			type: 'status',
			status: 'running',
			timestamp: Date.now(),
		};

		try {
			// Process initial input
			const initialInput = this.inputQueue.shift();
			if (!initialInput?.message) {
				this.logger.warn('No initial input message — skipping LLM call');
			}
			if (initialInput?.message) {
				this.logger.debug({ messageLength: initialInput.message.length }, 'Processing initial input');
				// Create async queue for streaming events in real-time
				const eventQueue = new AsyncEventQueue<AgentEvent>();

				// Subscribe to events and push them to the queue as they arrive
				const unsubscribe = this.agent.subscribe((piEvent) => {
					this.logger.debug({ piEventType: piEvent.type }, 'Pi event received');
					const mapped = mapPiEvent(piEvent, this.toolCallTimes);
					if (mapped) {
						if (Array.isArray(mapped)) {
							for (const e of mapped) {
								eventQueue.push(e);
							}
						} else {
							eventQueue.push(mapped);
						}
					}

					// Track turn count
					if (piEvent.type === 'turn_end') {
						this.turnCount++;
					}
				});

				// Track any error from the prompt
				let promptError: unknown = null;

				// Run the prompt concurrently - close queue when done
				const promptPromise = this.agent
					.prompt(initialInput.message)
					.catch((error) => {
						promptError = error;
					})
					.finally(() => {
						unsubscribe();
						eventQueue.close();
					});

				// Yield events as they arrive from the queue
				while (true) {
					const event = await eventQueue.pull();
					if (event === null) break;

					// Check for pause between events
					if (this.pausePromise) {
						yield {
							type: 'status',
							status: 'paused',
							timestamp: Date.now(),
						};
						await this.pausePromise;
						yield {
							type: 'status',
							status: 'running',
							timestamp: Date.now(),
						};
					}
					yield event;
				}

				// Wait for prompt to fully complete
				await promptPromise;

				// Re-throw any error from the prompt
				if (promptError) {
					throw promptError;
				}

				// Check if the LLM returned an error response that was silently handled
				const lastMsg = this.agent.state.messages[this.agent.state.messages.length - 1];
				if (lastMsg && 'stopReason' in lastMsg && lastMsg.stopReason === 'error') {
					const errorText = this.extractErrorFromMessage(lastMsg);
					throw new Error(`LLM returned error response: ${errorText}`);
				}

				// Check for pending suspensions
				if (this.pendingRequests.length > 0) {
					this._status = 'waiting';
					yield {
						type: 'status',
						status: 'waiting',
						timestamp: Date.now(),
					};
					yield {
						type: 'suspended',
						pendingRequests: [...this.pendingRequests],
						timestamp: Date.now(),
					};
				}
			}

			// Handle completion
			if (this._status !== 'waiting' && this.pendingRequests.length === 0) {
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
			// Check for suspension
			if (isSuspensionError(error)) {
				// Suspension is handled via callback
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
		this.abortController.abort();
		this.agent.abort();
		this._status = 'aborted';
	}

	async checkpoint(): Promise<InstanceCheckpoint> {
		const messages = this.agent.state.messages as Message[];

		return {
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

	resolve(resolutions: PendingResolution[]): void {
		for (const resolution of resolutions) {
			this.pendingResolutions.set(resolution.toolCallId, resolution);

			// Check if we have a resolver for this
			const resolver = this.suspensionResolvers.get(resolution.toolCallId);
			if (resolver) {
				if (resolution.cancel) {
					resolver.reject(new Error('Suspension cancelled'));
				} else {
					resolver.resolve(resolution.result ?? resolution.approved);
				}
				this.suspensionResolvers.delete(resolution.toolCallId);
			}

			// Update tracker with resume data
			if (!resolution.cancel && resolution.result !== undefined) {
				const pending = this.pendingRequests.find((r) => r.toolCallId === resolution.toolCallId);
				if (pending) {
					this.tracker.resumeData.set(resolution.toolCallId, {
						stepId: `${resolution.toolCallId}:suspended`,
						result: resolution.result,
					});
				}
			}

			// Remove from pending
			this.pendingRequests = this.pendingRequests.filter((r) => r.toolCallId !== resolution.toolCallId);
		}

		// If all pending resolved, resume
		if (this.pendingRequests.length === 0 && this._status === 'waiting') {
			this._status = 'running';
		}
	}

	private handleSuspension(toolCallId: string, toolName: string, stepId: string, request: SuspensionRequest): void {
		const pendingRequest: PendingRequestInfo = {
			toolCallId,
			toolName,
			type: request.type,
			request: this.suspensionRequestToData(request),
			suspendedAt: Date.now(),
		};

		this.pendingRequests.push(pendingRequest);

		// Store tool execution state for checkpoint
		this.toolExecutionStates.set(toolCallId, {
			toolName,
			toolCallId,
			input: this.tracker.toolInput,
			completedSteps: this.tracker.stepContext?.getCompletedSteps() ?? [],
			suspendedStep: {
				stepId,
				request,
				suspendedAt: Date.now(),
			},
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
	if (config.contextInjection?.resumeMessages && config.contextInjection.resumeMessages.length > 0) {
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
	};

	return new PiAgentInstance(config, model, systemPrompt, {
		apiKey: options.apiKey,
		thinkingLevel: options.thinkingLevel,
		restoreOptions,
	});
}
