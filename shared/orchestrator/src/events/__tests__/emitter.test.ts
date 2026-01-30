/**
 * Tests for TypedEventEmitter.
 */

import { describe, expect, it, vi } from 'vitest';
import { TypedEventEmitter, waitForEvent } from '../emitter.js';

describe('TypedEventEmitter', () => {
	describe('on', () => {
		it('should call handler when event is emitted', () => {
			const emitter = new TypedEventEmitter<{ value: number }>();
			const handler = vi.fn();

			emitter.on(handler);
			emitter.emit({ value: 42 });

			expect(handler).toHaveBeenCalledWith({ value: 42 });
		});

		it('should return a dispose function', () => {
			const emitter = new TypedEventEmitter<{ value: number }>();
			const handler = vi.fn();

			const dispose = emitter.on(handler);
			dispose();
			emitter.emit({ value: 42 });

			expect(handler).not.toHaveBeenCalled();
		});

		it('should support multiple handlers', () => {
			const emitter = new TypedEventEmitter<{ value: number }>();
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			emitter.on(handler1);
			emitter.on(handler2);
			emitter.emit({ value: 42 });

			expect(handler1).toHaveBeenCalledWith({ value: 42 });
			expect(handler2).toHaveBeenCalledWith({ value: 42 });
		});
	});

	describe('off', () => {
		it('should remove a handler', () => {
			const emitter = new TypedEventEmitter<{ value: number }>();
			const handler = vi.fn();

			emitter.on(handler);
			emitter.off(handler);
			emitter.emit({ value: 42 });

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('once', () => {
		it('should call handler only once', () => {
			const emitter = new TypedEventEmitter<{ value: number }>();
			const handler = vi.fn();

			emitter.once(handler);
			emitter.emit({ value: 1 });
			emitter.emit({ value: 2 });

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith({ value: 1 });
		});

		it('should return a dispose function', () => {
			const emitter = new TypedEventEmitter<{ value: number }>();
			const handler = vi.fn();

			const dispose = emitter.once(handler);
			dispose();
			emitter.emit({ value: 42 });

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('emit', () => {
		it('should emit events to all handlers', () => {
			const emitter = new TypedEventEmitter<{ type: string; data: number }>();
			const events: { type: string; data: number }[] = [];

			emitter.on((event) => events.push(event));
			emitter.emit({ type: 'test', data: 1 });
			emitter.emit({ type: 'test', data: 2 });

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({ type: 'test', data: 1 });
			expect(events[1]).toEqual({ type: 'test', data: 2 });
		});
	});

	describe('removeAllListeners', () => {
		it('should remove all handlers', () => {
			const emitter = new TypedEventEmitter<{ value: number }>();
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			emitter.on(handler1);
			emitter.on(handler2);
			emitter.removeAllListeners();
			emitter.emit({ value: 42 });

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
		});
	});

	describe('asyncIterator', () => {
		it('should yield emitted events', async () => {
			const emitter = new TypedEventEmitter<{ value: number; done?: boolean }>();
			const events: { value: number; done?: boolean }[] = [];

			// Emit events asynchronously
			setTimeout(() => {
				emitter.emit({ value: 1 });
				emitter.emit({ value: 2 });
				emitter.emit({ value: 3, done: true });
			}, 10);

			for await (const event of emitter) {
				events.push(event);
				if (event.done) break;
			}

			expect(events).toHaveLength(3);
			expect(events.map((e) => e.value)).toEqual([1, 2, 3]);
		});

		it('should terminate when complete() is called', async () => {
			const emitter = new TypedEventEmitter<{ value: number }>();
			const events: { value: number }[] = [];

			// Emit events and then complete
			setTimeout(() => {
				emitter.emit({ value: 1 });
				emitter.emit({ value: 2 });
				emitter.complete();
			}, 10);

			for await (const event of emitter) {
				events.push(event);
			}

			expect(events).toHaveLength(2);
			expect(events.map((e) => e.value)).toEqual([1, 2]);
		});

		it('should not iterate when already completed', async () => {
			const emitter = new TypedEventEmitter<{ value: number }>();
			const events: { value: number }[] = [];

			emitter.complete();

			for await (const event of emitter) {
				events.push(event);
			}

			expect(events).toHaveLength(0);
		});

		it('should terminate immediately when complete() is called while waiting', async () => {
			const emitter = new TypedEventEmitter<{ value: number }>();
			const events: { value: number }[] = [];

			// Complete without emitting any events
			setTimeout(() => {
				emitter.complete();
			}, 10);

			for await (const event of emitter) {
				events.push(event);
			}

			expect(events).toHaveLength(0);
			expect(emitter.isCompleted).toBe(true);
		});
	});

	describe('complete', () => {
		it('should set isCompleted to true', () => {
			const emitter = new TypedEventEmitter<{ value: number }>();

			expect(emitter.isCompleted).toBe(false);
			emitter.complete();
			expect(emitter.isCompleted).toBe(true);
		});

		it('should be idempotent', () => {
			const emitter = new TypedEventEmitter<{ value: number }>();

			emitter.complete();
			emitter.complete();
			expect(emitter.isCompleted).toBe(true);
		});
	});
});

describe('waitForEvent', () => {
	it('should resolve when matching event is emitted', async () => {
		const emitter = new TypedEventEmitter<{ type: string; value: number }>();

		const promise = waitForEvent(emitter, (e) => e.type === 'match');

		// Emit non-matching event
		emitter.emit({ type: 'other', value: 1 });

		// Emit matching event
		setTimeout(() => emitter.emit({ type: 'match', value: 42 }), 10);

		const result = await promise;
		expect(result).toEqual({ type: 'match', value: 42 });
	});

	it('should timeout if no matching event', async () => {
		const emitter = new TypedEventEmitter<{ type: string }>();

		await expect(waitForEvent(emitter, (e) => e.type === 'never', { timeout: 50 })).rejects.toThrow(
			'Timeout waiting for event',
		);
	});

	it('should resolve immediately if event already matches', async () => {
		const emitter = new TypedEventEmitter<{ ready: boolean }>();

		// Emit event before starting wait
		emitter.emit({ ready: true });

		// Wait with initial value
		const promise = waitForEvent(emitter, () => true);

		// Emit another event to trigger
		setTimeout(() => emitter.emit({ ready: true }), 0);

		const result = await promise;
		expect(result).toEqual({ ready: true });
	});
});
