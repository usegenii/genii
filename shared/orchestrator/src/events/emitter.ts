/**
 * Type-safe event emitter utility.
 */

import type { Disposable } from '../types/core.js';

/**
 * Event handler function type.
 */
export type EventHandler<T> = (event: T) => void;

/**
 * Type-safe event emitter.
 *
 * @example
 * ```typescript
 * type MyEvents = { type: "foo"; data: string } | { type: "bar"; count: number };
 * const emitter = new TypedEventEmitter<MyEvents>();
 *
 * emitter.on(event => {
 *   if (event.type === "foo") {
 *     console.log(event.data);
 *   }
 * });
 *
 * emitter.emit({ type: "foo", data: "hello" });
 * ```
 */
export class TypedEventEmitter<T> {
	private listeners = new Set<EventHandler<T>>();
	private onceListeners = new Map<EventHandler<T>, EventHandler<T>>();
	private _completed = false;
	private _iteratorResolvers = new Set<(value: IteratorResult<T>) => void>();

	/**
	 * Subscribe to events.
	 *
	 * @param handler - Function to call when an event is emitted
	 * @returns Disposable to unsubscribe
	 */
	on(handler: EventHandler<T>): Disposable {
		this.listeners.add(handler);
		return () => this.off(handler);
	}

	/**
	 * Unsubscribe from events.
	 *
	 * @param handler - Handler to remove
	 */
	off(handler: EventHandler<T>): void {
		this.listeners.delete(handler);
		// Also clean up if this was a once listener
		const onceWrapper = this.onceListeners.get(handler);
		if (onceWrapper) {
			this.listeners.delete(onceWrapper);
			this.onceListeners.delete(handler);
		}
	}

	/**
	 * Subscribe to a single event.
	 *
	 * @param handler - Function to call when an event is emitted (once)
	 * @returns Disposable to unsubscribe
	 */
	once(handler: EventHandler<T>): Disposable {
		const wrapper: EventHandler<T> = (event) => {
			this.listeners.delete(wrapper);
			this.onceListeners.delete(handler);
			handler(event);
		};
		this.onceListeners.set(handler, wrapper);
		this.listeners.add(wrapper);
		return () => {
			this.listeners.delete(wrapper);
			this.onceListeners.delete(handler);
		};
	}

	/**
	 * Emit an event to all listeners.
	 *
	 * @param event - Event to emit
	 */
	emit(event: T): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error) {
				// Log but don't throw to avoid breaking other listeners
				console.error('Error in event listener:', error);
			}
		}
	}

	/**
	 * Get the number of listeners.
	 */
	get listenerCount(): number {
		return this.listeners.size;
	}

	/**
	 * Remove all listeners.
	 */
	removeAllListeners(): void {
		this.listeners.clear();
		this.onceListeners.clear();
	}

	/**
	 * Check if the emitter has been completed.
	 */
	get isCompleted(): boolean {
		return this._completed;
	}

	/**
	 * Mark the emitter as completed.
	 * This will cause any active async iterators to terminate.
	 */
	complete(): void {
		this._completed = true;
		// Resolve all waiting iterators with done: true
		for (const resolve of this._iteratorResolvers) {
			resolve({ value: undefined as T, done: true });
		}
		this._iteratorResolvers.clear();
	}

	/**
	 * Create an async iterator for events.
	 * The iterator will yield events as they are emitted.
	 * The iterator will terminate when complete() is called on the emitter,
	 * after draining any remaining events in the queue.
	 */
	async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
		const queue: T[] = [];
		let resolve: ((value: IteratorResult<T>) => void) | null = null;
		let done = false;

		// If already completed, don't start iterating
		if (this._completed) {
			return;
		}

		const dispose = this.on((event) => {
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
					if (event !== undefined) {
						yield event;
					}
				} else if (this._completed) {
					// Queue is empty and completed, we're done
					done = true;
				} else {
					const result = await new Promise<IteratorResult<T>>((r) => {
						resolve = r;
						this._iteratorResolvers.add(r);
					});
					// Clean up the resolver from the set
					if (resolve) {
						this._iteratorResolvers.delete(resolve);
						resolve = null;
					}
					if (result.done) {
						// Don't immediately set done - check queue first
						// Loop will continue and drain queue before exiting
					} else {
						yield result.value;
					}
				}
			}
		} finally {
			// Clean up resolve if still registered
			if (resolve) {
				this._iteratorResolvers.delete(resolve);
			}
			dispose();
		}
	}
}

/**
 * Create a promise that resolves when a specific event is emitted.
 *
 * @param emitter - Event emitter to listen to
 * @param predicate - Function to test if this is the desired event
 * @param options - Options including timeout
 * @returns Promise that resolves with the matching event
 */
export function waitForEvent<T>(
	emitter: TypedEventEmitter<T>,
	predicate: (event: T) => boolean,
	options?: { timeout?: number },
): Promise<T> {
	return new Promise((resolve, reject) => {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		const dispose = emitter.on((event) => {
			if (predicate(event)) {
				if (timeoutId) clearTimeout(timeoutId);
				dispose();
				resolve(event);
			}
		});

		if (options?.timeout) {
			timeoutId = setTimeout(() => {
				dispose();
				reject(new Error('Timeout waiting for event'));
			}, options.timeout);
		}
	});
}
