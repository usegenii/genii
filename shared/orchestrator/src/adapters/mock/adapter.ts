/**
 * Mock adapter for testing.
 */

import type { AgentEvent, PendingRequestInfo, PendingResolution } from '../../events/types';
import type { AgentCheckpoint, InstanceCheckpoint } from '../../snapshot/types';
import type { AgentSessionId } from '../../types/core';
import { generateAgentSessionId } from '../../types/core';
import type { AdapterCreateConfig, AgentAdapter, AgentInstance, AgentInstanceStatus } from '../types';

/**
 * Options for the mock adapter.
 */
export interface MockAdapterOptions {
	/** Delay between events in milliseconds */
	eventDelay?: number;
	/** Responses to return for specific inputs */
	responses?: Map<string, string>;
	/** Whether to simulate tool calls */
	simulateToolCalls?: boolean;
	/** Error to throw (if any) */
	errorAfterTurns?: number;
}

/**
 * Mock adapter for testing without real LLM calls.
 */
export class MockAgentAdapter implements AgentAdapter {
	readonly name = 'mock';
	readonly modelProvider = 'mock';
	readonly modelName = 'mock-model';
	private options: MockAdapterOptions;

	constructor(options: MockAdapterOptions = {}) {
		this.options = options;
	}

	async create(config: AdapterCreateConfig): Promise<AgentInstance> {
		return new MockAgentInstance(config, this.options);
	}

	async restore(_checkpoint: AgentCheckpoint, _config: AdapterCreateConfig): Promise<AgentInstance> {
		// For testing, just create a new instance
		// In a real adapter, this would restore from the checkpoint
		throw new Error('Mock adapter does not support restore');
	}
}

/**
 * Mock agent instance for testing.
 */
class MockAgentInstance implements AgentInstance {
	readonly id: string;
	private config: AdapterCreateConfig;
	private options: MockAdapterOptions;
	private _status: AgentInstanceStatus = 'idle';
	private pendingRequests: PendingRequestInfo[] = [];
	private pendingResolutions: PendingResolution[] = [];
	private abortController = new AbortController();
	private inputQueue: string[] = [];
	private turnCount = 0;
	private pausePromise: Promise<void> | null = null;
	private pauseResolve: (() => void) | null = null;

	constructor(config: AdapterCreateConfig, options: MockAdapterOptions) {
		this.id = generateAgentSessionId();
		this.config = config;
		this.options = options;

		if (config.input?.message) {
			this.inputQueue.push(config.input.message);
		}
	}

	async *run(): AsyncIterable<AgentEvent> {
		this._status = 'running';

		yield {
			type: 'status',
			status: 'running',
			timestamp: Date.now(),
		};

		try {
			while (this.inputQueue.length > 0 || this.turnCount === 0) {
				// Check for abort
				if (this.abortController.signal.aborted) {
					break;
				}

				// Check for pause
				if (this.pausePromise) {
					this._status = 'paused';
					yield {
						type: 'status',
						status: 'paused',
						timestamp: Date.now(),
					};
					await this.pausePromise;
					this._status = 'running';
					yield {
						type: 'status',
						status: 'running',
						timestamp: Date.now(),
					};
				}

				// Get next input
				const input = this.inputQueue.shift() ?? 'Hello';

				// Check for error simulation
				if (this.options.errorAfterTurns !== undefined && this.turnCount >= this.options.errorAfterTurns) {
					throw new Error('Simulated error');
				}

				// Simulate thinking delay
				if (this.options.eventDelay) {
					await this.delay(this.options.eventDelay);
				}

				// Emit thought
				yield {
					type: 'thought',
					content: `Processing: "${input}"`,
					timestamp: Date.now(),
				};

				// Generate response
				const response = this.options.responses?.get(input) ?? `Mock response to: "${input}"`;

				// Simulate tool call if configured
				const tools = this.config.tools?.all() ?? [];
				if (this.options.simulateToolCalls && tools.length > 0) {
					const tool = tools[0];
					if (tool) {
						const toolCallId = `mock-tool-${this.turnCount}`;

						yield {
							type: 'tool_start',
							toolCallId,
							toolName: tool.name,
							input: { test: true },
							timestamp: Date.now(),
						};

						if (this.options.eventDelay) {
							await this.delay(this.options.eventDelay);
						}

						yield {
							type: 'tool_end',
							toolCallId,
							toolName: tool.name,
							output: { result: 'mock result' },
							durationMs: this.options.eventDelay ?? 0,
							timestamp: Date.now(),
						};
					}
				}

				// Emit output
				yield {
					type: 'output',
					text: response,
					final: true,
					timestamp: Date.now(),
				};

				this.turnCount++;
			}

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
					output: 'Mock execution completed',
					metrics: {
						durationMs: 0,
						turns: this.turnCount,
						toolCalls: this.options.simulateToolCalls ? this.turnCount : 0,
					},
				},
				timestamp: Date.now(),
			};
		} catch (error) {
			this._status = 'failed';

			yield {
				type: 'error',
				error: error instanceof Error ? error.message : String(error),
				fatal: true,
				timestamp: Date.now(),
			};

			yield {
				type: 'done',
				result: {
					status: 'failed',
					error: error instanceof Error ? error.message : String(error),
					metrics: {
						durationMs: 0,
						turns: this.turnCount,
						toolCalls: 0,
					},
				},
				timestamp: Date.now(),
			};
		}
	}

	send(input: { message?: string }): void {
		if (input.message) {
			this.inputQueue.push(input.message);
		}
	}

	async pause(): Promise<void> {
		if (this._status === 'running') {
			this.pausePromise = new Promise((resolve) => {
				this.pauseResolve = resolve;
			});
		}
	}

	async resume(): Promise<void> {
		if (this.pauseResolve) {
			this.pauseResolve();
			this.pausePromise = null;
			this.pauseResolve = null;
		}
	}

	abort(): void {
		this.abortController.abort();
		this._status = 'aborted';
	}

	async checkpoint(): Promise<InstanceCheckpoint> {
		return {
			timestamp: Date.now(),
			adapterName: 'mock',
			session: {
				id: this.id as AgentSessionId,
				createdAt: Date.now(),
				tags: this.config.tags ?? [],
				metadata: this.config.metadata ?? {},
				task: this.config.task,
				metrics: {
					durationMs: 0,
					turns: this.turnCount,
					toolCalls: 0,
				},
			},
			guidance: {
				guidancePath: this.config.guidance.root,
				memoryWrites: [],
				systemState: {},
			},
			messages: [],
			adapterConfig: {},
			toolExecutions: [],
		};
	}

	status(): AgentInstanceStatus {
		return this._status;
	}

	getPendingRequests(): PendingRequestInfo[] {
		return this.pendingRequests;
	}

	resolve(resolutions: PendingResolution[]): void {
		this.pendingResolutions.push(...resolutions);
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

/**
 * Create a mock adapter.
 */
export function createMockAdapter(options?: MockAdapterOptions): MockAgentAdapter {
	return new MockAgentAdapter(options);
}
