/**
 * Pi agent instance implementation.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { Agent } from '@mariozechner/pi-agent-core';
import type { Api, Model } from '@mariozechner/pi-ai';
import { getModels, streamSimple } from '@mariozechner/pi-ai';
import type { AgentEvent, PendingRequestInfo, PendingResolution, SuspensionRequestData } from '../../events/types';
import type { AgentCheckpoint, ToolExecutionState } from '../../snapshot/types';
import { CHECKPOINT_VERSION } from '../../snapshot/types';
import { isSuspensionError } from '../../tools/suspension';
import type { SuspensionRequest } from '../../tools/types';
import type { AgentInput, AgentSessionId } from '../../types/core';
import { generateAgentSessionId } from '../../types/core';
import type { AdapterCreateConfig, AgentInstance, AgentInstanceStatus } from '../types';
import { mapPiEvent } from './events';
import {
	buildPiTools,
	buildSystemPromptWithTask,
	createToolExecutionTracker,
	type ToolExecutionTracker,
} from './guidance';

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

	constructor(
		config: AdapterCreateConfig,
		model: Model<Api>,
		systemPrompt: string,
		options: {
			apiKey?: string | (() => Promise<string | undefined>);
			thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
		} = {},
	) {
		this.id = generateAgentSessionId();
		this.config = config;
		this.tracker = createToolExecutionTracker();

		if (typeof options.apiKey === 'function') {
			this.apiKeyGetter = options.apiKey;
		}

		if (options.thinkingLevel && options.thinkingLevel !== 'off') {
			this.thinkingLevel = options.thinkingLevel;
		}

		// Build Pi tools from our tools
		const piTools = buildPiTools(
			config.tools.all(),
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

		// Create the Pi Agent
		this.agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: this.thinkingLevel,
				tools: piTools,
				messages: [],
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
			if (initialInput?.message) {
				// Subscribe to events and yield them
				const events: AgentEvent[] = [];
				const unsubscribe = this.agent.subscribe((piEvent) => {
					const mapped = mapPiEvent(piEvent, this.toolCallTimes);
					if (mapped) {
						if (Array.isArray(mapped)) {
							events.push(...mapped);
						} else {
							events.push(mapped);
						}
					}

					// Track turn count
					if (piEvent.type === 'turn_end') {
						this.turnCount++;
					}
				});

				try {
					// Run the prompt
					await this.agent.prompt(initialInput.message);

					// Yield collected events
					for (const event of events) {
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
				} finally {
					unsubscribe();
				}
			}

			// Handle completion
			if (this._status !== 'waiting' && this.pendingRequests.length === 0) {
				this._status = 'completed';
				yield {
					type: 'status',
					status: 'completed',
					timestamp: Date.now(),
				};
				yield {
					type: 'done',
					result: {
						status: 'completed',
						output: this.getLastAssistantMessage(),
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

	async checkpoint(): Promise<AgentCheckpoint> {
		const messages = this.agent.state.messages;

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
			adapterState: {
				messages: messages.map((m) => this.serializeMessage(m)),
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

	private serializeMessage(message: AgentMessage): unknown {
		// Deep clone to ensure we can serialize
		return JSON.parse(JSON.stringify(message));
	}
}

/**
 * Create a Pi agent instance.
 */
export async function createPiAgentInstance(
	config: AdapterCreateConfig,
	options: {
		provider: 'anthropic' | 'openai' | 'google';
		model: string;
		apiKey?: string | (() => Promise<string | undefined>);
		thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
		baseUrl?: string;
	},
): Promise<PiAgentInstance> {
	// Get model
	const models = getModels(options.provider);
	const model = models.find((m) => m.id === options.model || m.name === options.model);

	if (!model) {
		throw new Error(`Model "${options.model}" not found for provider "${options.provider}"`);
	}

	// Build system prompt
	const systemPrompt = await buildSystemPromptWithTask(config.guidance, config.task);

	return new PiAgentInstance(config, model, systemPrompt, {
		apiKey: options.apiKey,
		thinkingLevel: options.thinkingLevel,
	});
}
