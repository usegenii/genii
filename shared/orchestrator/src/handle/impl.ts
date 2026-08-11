/**
 * Agent handle implementation.
 */

import type { AgentInstance } from '../adapters/types';
import { TypedEventEmitter } from '../events/emitter';
import type { AgentEvent, PendingRequestInfo, PendingResolution } from '../events/types';
import type { InstanceCheckpoint } from '../snapshot/types';
import type {
	AgentInput,
	AgentResult,
	AgentSessionId,
	AgentSnapshot,
	AgentSpawnConfig,
	AgentStatus,
	Disposable,
} from '../types/core';
import type { AgentHandle } from './types';

/**
 * Implementation of AgentHandle.
 */
export class AgentHandleImpl implements AgentHandle {
	readonly id: AgentSessionId;
	readonly config: AgentSpawnConfig;
	readonly createdAt: Date;

	private instance: AgentInstance;
	private emitter = new TypedEventEmitter<AgentEvent>();
	private _status: AgentStatus = 'initializing';
	private result: AgentResult | null = null;
	private waitPromise: Promise<AgentResult> | null = null;
	private waitResolve: ((result: AgentResult) => void) | null = null;
	private eventHistory: AgentEvent[] = [];
	private running = false;
	private terminated = false;
	private activeIterator: AsyncIterator<AgentEvent> | null = null;

	constructor(instance: AgentInstance, config: AgentSpawnConfig) {
		this.id = instance.id as AgentSessionId;
		this.instance = instance;
		this.config = config;
		this.createdAt = new Date();
		// A restored durable suspension is already fully parked before its
		// event iterator starts. Preserve that state so shutdown can detach it
		// without treating it like an unstarted ordinary session.
		if (instance.status() === 'waiting') {
			this._status = 'waiting';
		}
	}

	get status(): AgentStatus {
		return this._status;
	}

	/**
	 * Start the agent execution loop.
	 */
	async start(): Promise<void> {
		if (this.running || this.terminated) return;
		this.running = true;
		let iterator: AsyncIterator<AgentEvent> | null = null;

		try {
			iterator = this.instance.run()[Symbol.asyncIterator]();
			this.activeIterator = iterator;
			while (!this.terminated) {
				const next = await iterator.next();
				if (next.done || this.terminated) break;
				this.handleEvent(next.value);
			}
		} catch (error) {
			if (!this.terminated) {
				this.handleEvent({
					type: 'error',
					error: error instanceof Error ? error.message : String(error),
					fatal: true,
					stack: error instanceof Error ? error.stack : undefined,
					timestamp: Date.now(),
				});
			}
		} finally {
			if (this.activeIterator === iterator) {
				this.activeIterator = null;
			}
			this.running = false;
		}
	}

	private handleEvent(event: AgentEvent): void {
		if (this.terminated) return;

		// Track event
		this.eventHistory.push(event);

		// Update status
		if (event.type === 'status') {
			this._status = event.status;
		}

		// Handle done event
		if (event.type === 'done') {
			this.result = event.result;
			this._status = event.result.status;
			if (this.waitResolve) {
				this.waitResolve(event.result);
			}
		}

		// Emit to subscribers
		this.emitter.emit(event);
	}

	subscribe(handler: (event: AgentEvent) => void): Disposable {
		return this.emitter.on(handler);
	}

	async *events(): AsyncIterable<AgentEvent> {
		// Yield historical events first
		for (const event of this.eventHistory) {
			yield event;
		}

		// Then yield new events
		const queue: AgentEvent[] = [];
		let resolve: ((value: IteratorResult<AgentEvent>) => void) | null = null;
		let done = false;

		const dispose = this.emitter.on((event) => {
			if (event.type === 'done') {
				done = true;
			}
			if (resolve) {
				resolve({ value: event, done: false });
				resolve = null;
			} else {
				queue.push(event);
			}
		});

		try {
			while (!done) {
				if (queue.length > 0) {
					const event = queue.shift();
					if (event === undefined) continue;
					if (event.type === 'done') {
						yield event;
						break;
					}
					yield event;
				} else {
					const result = await new Promise<IteratorResult<AgentEvent>>((r) => {
						resolve = r;
					});
					if (result.value.type === 'done') {
						yield result.value;
						break;
					}
					yield result.value;
				}
			}
		} finally {
			dispose();
		}
	}

	async send(input: AgentInput): Promise<void> {
		if (this._status === 'waiting' || this.instance.getPendingRequests().length > 0) {
			throw new Error(`Agent ${this.id} is waiting for a suspension resolution`);
		}
		this.instance.send(input);
	}

	async pause(): Promise<void> {
		await this.instance.pause();
		if (!this.terminated) this._status = 'paused';
	}

	async resume(): Promise<void> {
		await this.instance.resume();
		if (!this.terminated) this._status = 'running';
	}

	async terminate(reason?: string): Promise<void> {
		if (this.terminated) return;
		this.terminated = true;
		this.instance.abort();
		this.closeActiveIterator();
		this._status = 'terminated';

		const terminateResult: AgentResult = {
			status: 'terminated',
			error: reason ?? 'Agent terminated',
			metrics: {
				durationMs: Date.now() - this.createdAt.getTime(),
				turns: 0,
				toolCalls: 0,
			},
		};

		this.result = terminateResult;
		if (this.waitResolve) {
			this.waitResolve(terminateResult);
		}

		this.emitter.emit({
			type: 'done',
			result: terminateResult,
			timestamp: Date.now(),
		});
	}

	private closeActiveIterator(): void {
		const iterator = this.activeIterator;
		this.activeIterator = null;
		if (!iterator?.return) return;

		try {
			void Promise.resolve(iterator.return()).catch(() => undefined);
		} catch {
			// The instance has already been aborted; iterator cleanup is best effort.
		}
	}

	wait(): Promise<AgentResult> {
		if (this.result) {
			return Promise.resolve(this.result);
		}

		if (!this.waitPromise) {
			this.waitPromise = new Promise((resolve) => {
				this.waitResolve = resolve;
			});
		}

		return this.waitPromise;
	}

	snapshot(): AgentSnapshot {
		return {
			id: crypto.randomUUID(),
			sessionId: this.id,
			timestamp: Date.now(),
			status: this._status,
			metrics: {
				durationMs: Date.now() - this.createdAt.getTime(),
				turns: 0,
				toolCalls: 0,
			},
		};
	}

	getPendingRequests(): PendingRequestInfo[] {
		return this.instance.getPendingRequests();
	}

	async resolve(resolutions: PendingResolution[]): Promise<void> {
		await this.instance.resolve(resolutions);
	}

	/**
	 * Get a full checkpoint of the agent state.
	 */
	async checkpoint(): Promise<InstanceCheckpoint> {
		return this.instance.checkpoint();
	}
}

/**
 * Create an agent handle from an instance.
 */
export function createAgentHandle(instance: AgentInstance, config: AgentSpawnConfig): AgentHandleImpl {
	return new AgentHandleImpl(instance, config);
}
