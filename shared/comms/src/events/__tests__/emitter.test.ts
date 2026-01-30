import { describe, expect, it, vi } from 'vitest';
import { TypedEventEmitter, waitForEvent } from '../emitter';

interface TestEvent {
	type: 'foo' | 'bar';
	value: number;
}

describe('TypedEventEmitter', () => {
	describe('on()', () => {
		it('should subscribe and receive events', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler = vi.fn();

			emitter.on(handler);
			emitter.emit({ type: 'foo', value: 42 });

			expect(handler).toHaveBeenCalledWith({ type: 'foo', value: 42 });
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('should return a disposable that unsubscribes', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler = vi.fn();

			const dispose = emitter.on(handler);
			dispose();
			emitter.emit({ type: 'foo', value: 42 });

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('off()', () => {
		it('should unsubscribe from events', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler = vi.fn();

			emitter.on(handler);
			emitter.off(handler);
			emitter.emit({ type: 'foo', value: 42 });

			expect(handler).not.toHaveBeenCalled();
		});

		it('should handle unsubscribing a non-existent handler gracefully', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler = vi.fn();

			expect(() => emitter.off(handler)).not.toThrow();
		});
	});

	describe('once()', () => {
		it('should receive only one event then auto-unsubscribe', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler = vi.fn();

			emitter.once(handler);
			emitter.emit({ type: 'foo', value: 1 });
			emitter.emit({ type: 'bar', value: 2 });

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith({ type: 'foo', value: 1 });
		});

		it('should return a disposable that unsubscribes before receiving', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler = vi.fn();

			const dispose = emitter.once(handler);
			dispose();
			emitter.emit({ type: 'foo', value: 42 });

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('emit()', () => {
		it('should emit to all listeners', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			const handler3 = vi.fn();

			emitter.on(handler1);
			emitter.on(handler2);
			emitter.on(handler3);
			emitter.emit({ type: 'foo', value: 42 });

			expect(handler1).toHaveBeenCalledWith({ type: 'foo', value: 42 });
			expect(handler2).toHaveBeenCalledWith({ type: 'foo', value: 42 });
			expect(handler3).toHaveBeenCalledWith({ type: 'foo', value: 42 });
		});

		it('should not break other listeners when one throws', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler1 = vi.fn();
			const throwingHandler = vi.fn(() => {
				throw new Error('Test error');
			});
			const handler2 = vi.fn();

			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

			emitter.on(handler1);
			emitter.on(throwingHandler);
			emitter.on(handler2);
			emitter.emit({ type: 'foo', value: 42 });

			expect(handler1).toHaveBeenCalled();
			expect(throwingHandler).toHaveBeenCalled();
			expect(handler2).toHaveBeenCalled();
			expect(consoleError).toHaveBeenCalled();

			consoleError.mockRestore();
		});
	});

	describe('listenerCount', () => {
		it('should return correct count', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			expect(emitter.listenerCount).toBe(0);

			emitter.on(handler1);
			expect(emitter.listenerCount).toBe(1);

			emitter.on(handler2);
			expect(emitter.listenerCount).toBe(2);

			emitter.off(handler1);
			expect(emitter.listenerCount).toBe(1);
		});

		it('should count once listeners correctly', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler = vi.fn();

			emitter.once(handler);
			expect(emitter.listenerCount).toBe(1);

			emitter.emit({ type: 'foo', value: 42 });
			expect(emitter.listenerCount).toBe(0);
		});
	});

	describe('removeAllListeners()', () => {
		it('should clear all listeners', () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			emitter.on(handler1);
			emitter.once(handler2);
			expect(emitter.listenerCount).toBe(2);

			emitter.removeAllListeners();
			expect(emitter.listenerCount).toBe(0);

			emitter.emit({ type: 'foo', value: 42 });
			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
		});
	});

	describe('complete()', () => {
		it('should stop async iterator', async () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const events: TestEvent[] = [];

			const iteratorPromise = (async () => {
				for await (const event of emitter) {
					events.push(event);
				}
			})();

			emitter.emit({ type: 'foo', value: 1 });
			emitter.emit({ type: 'bar', value: 2 });

			// Allow events to be processed
			await new Promise((resolve) => setTimeout(resolve, 10));

			emitter.complete();

			await iteratorPromise;

			expect(events).toEqual([
				{ type: 'foo', value: 1 },
				{ type: 'bar', value: 2 },
			]);
		});
	});

	describe('isCompleted', () => {
		it('should reflect completion state', () => {
			const emitter = new TypedEventEmitter<TestEvent>();

			expect(emitter.isCompleted).toBe(false);

			emitter.complete();

			expect(emitter.isCompleted).toBe(true);
		});
	});

	describe('async iteration', () => {
		it('should yield events', async () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			const events: TestEvent[] = [];

			const iteratorPromise = (async () => {
				for await (const event of emitter) {
					events.push(event);
					if (events.length >= 3) {
						break;
					}
				}
			})();

			emitter.emit({ type: 'foo', value: 1 });
			emitter.emit({ type: 'bar', value: 2 });
			emitter.emit({ type: 'foo', value: 3 });

			await iteratorPromise;

			expect(events).toEqual([
				{ type: 'foo', value: 1 },
				{ type: 'bar', value: 2 },
				{ type: 'foo', value: 3 },
			]);
		});

		it('should not iterate if already completed', async () => {
			const emitter = new TypedEventEmitter<TestEvent>();
			emitter.complete();

			const events: TestEvent[] = [];

			for await (const event of emitter) {
				events.push(event);
			}

			expect(events).toEqual([]);
		});
	});
});

describe('waitForEvent()', () => {
	it('should resolve when matching event is emitted', async () => {
		const emitter = new TypedEventEmitter<TestEvent>();

		const promise = waitForEvent(emitter, (event) => event.type === 'bar');

		emitter.emit({ type: 'foo', value: 1 });
		emitter.emit({ type: 'bar', value: 42 });

		const result = await promise;

		expect(result).toEqual({ type: 'bar', value: 42 });
	});

	it('should reject on timeout', async () => {
		const emitter = new TypedEventEmitter<TestEvent>();

		const promise = waitForEvent(emitter, (event) => event.type === 'bar', { timeout: 50 });

		await expect(promise).rejects.toThrow('Timeout waiting for event');
	});

	it('should clear timeout when event matches', async () => {
		const emitter = new TypedEventEmitter<TestEvent>();

		const promise = waitForEvent(emitter, (event) => event.type === 'foo', { timeout: 1000 });

		emitter.emit({ type: 'foo', value: 42 });

		const result = await promise;

		expect(result).toEqual({ type: 'foo', value: 42 });
	});
});
