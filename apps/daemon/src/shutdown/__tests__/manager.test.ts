import { DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS } from '@genii/lib/rpc/methods';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../logging/logger';
import { ShutdownManager, type ShutdownMode } from '../manager';

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: (value) => resolvePromise?.(value),
	};
}

function blockEventLoop(timeoutMs: number): void {
	const blocker = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
	Atomics.wait(blocker, 0, 0, timeoutMs);
}

/** Create a minimal mock logger for testing. */
function createMockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(() => createMockLogger()),
	} as unknown as Logger;
}

afterEach(() => {
	vi.useRealTimers();
});

describe('ShutdownManager', () => {
	it('registers, replaces, and unregisters handlers', async () => {
		const logger = createMockLogger();
		const manager = new ShutdownManager(logger);
		const first = vi.fn().mockResolvedValue(undefined);
		const replacement = vi.fn().mockResolvedValue(undefined);

		manager.register('test-handler', first, 10);
		manager.register('test-handler', replacement, 20);
		manager.unregister('test-handler');
		const result = await manager.execute('graceful');

		expect(first).not.toHaveBeenCalled();
		expect(replacement).not.toHaveBeenCalled();
		expect(result).toEqual({ mode: 'graceful', completed: true, failedHandlers: [] });
		expect(logger.warn).toHaveBeenCalledWith({ name: 'test-handler' }, 'Replacing existing shutdown handler');
	});

	it('returns a graceful outcome while preserving priority order and same-priority parallelism', async () => {
		vi.useFakeTimers({ now: 1_000 });
		const manager = new ShutdownManager(createMockLogger());
		const executionOrder: string[] = [];
		const firstLevel = deferred<void>();

		manager.register(
			'first-a',
			async (mode, remainingTimeMs) => {
				executionOrder.push(`first-a:${mode}:${remainingTimeMs}`);
				await firstLevel.promise;
			},
			10,
		);
		manager.register(
			'first-b',
			async (mode, remainingTimeMs) => {
				executionOrder.push(`first-b:${mode}:${remainingTimeMs}`);
				await firstLevel.promise;
			},
			10,
		);
		manager.register(
			'second',
			async (mode, remainingTimeMs) => {
				executionOrder.push(`second:${mode}:${remainingTimeMs}`);
			},
			20,
		);

		const resultPromise = manager.execute('graceful');
		await Promise.resolve();
		await Promise.resolve();

		expect(executionOrder).toEqual([
			`first-a:graceful:${DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS}`,
			`first-b:graceful:${DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS}`,
		]);

		firstLevel.resolve(undefined);
		const result = await resultPromise;

		expect(executionOrder).toEqual([
			`first-a:graceful:${DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS}`,
			`first-b:graceful:${DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS}`,
			`second:graceful:${DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS}`,
		]);
		expect(result).toEqual({ mode: 'graceful', completed: true, failedHandlers: [] });
		expect(manager.isShuttingDown).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('escalates to hard mode when the graceful deadline expires', async () => {
		vi.useFakeTimers({ now: 0 });
		const manager = new ShutdownManager(createMockLogger(), { hardTimeoutMs: 500 });
		const receivedModes: ShutdownMode[] = [];
		let receivedSignal: AbortSignal | undefined;

		manager.register(
			'graceful-work',
			async (mode, _remainingTimeMs, signal) => {
				receivedModes.push(mode);
				receivedSignal = signal;
				await new Promise<void>((resolve) => {
					if (signal?.aborted) {
						resolve();
						return;
					}
					signal?.addEventListener('abort', () => resolve(), { once: true });
				});
			},
			10,
		);

		const resultPromise = manager.execute('graceful', 100);
		await vi.advanceTimersByTimeAsync(100);
		const result = await resultPromise;

		expect(receivedModes).toEqual(['graceful']);
		expect(receivedSignal?.aborted).toBe(true);
		expect(result).toEqual({ mode: 'hard', completed: true, failedHandlers: [] });
		expect(vi.getTimerCount()).toBe(0);
	});

	it('starts immediately in hard mode with one shared remaining-time budget', async () => {
		vi.useFakeTimers({ now: 0 });
		const manager = new ShutdownManager(createMockLogger(), { hardTimeoutMs: 250 });
		const calls: Array<{ mode: ShutdownMode; remainingTimeMs: number | undefined }> = [];

		manager.register(
			'first',
			async (mode, remainingTimeMs) => {
				calls.push({ mode, remainingTimeMs });
				await vi.advanceTimersByTimeAsync(50);
			},
			10,
		);
		manager.register(
			'second',
			async (mode, remainingTimeMs) => {
				calls.push({ mode, remainingTimeMs });
			},
			20,
		);

		const result = await manager.execute('hard');

		expect(calls).toEqual([
			{ mode: 'hard', remainingTimeMs: 250 },
			{ mode: 'hard', remainingTimeMs: 200 },
		]);
		expect(result).toEqual({ mode: 'hard', completed: true, failedHandlers: [] });
		expect(vi.getTimerCount()).toBe(0);
	});

	it('escalates when synchronous graceful work settles after its absolute deadline', async () => {
		const manager = new ShutdownManager(createMockLogger(), { hardTimeoutMs: 100 });
		manager.register(
			'blocking-work',
			async () => {
				blockEventLoop(25);
			},
			10,
		);

		await expect(manager.execute('graceful', 10)).resolves.toEqual({
			mode: 'hard',
			completed: true,
			failedHandlers: [],
		});
	});

	it('reports incomplete when synchronous hard work settles after its absolute deadline', async () => {
		const manager = new ShutdownManager(createMockLogger(), { hardTimeoutMs: 10 });
		manager.register(
			'blocking-work',
			async () => {
				blockEventLoop(25);
			},
			10,
		);

		await expect(manager.execute('hard')).resolves.toEqual({
			mode: 'hard',
			completed: false,
			failedHandlers: [],
		});
	});

	it('rechecks the hard deadline before reporting an otherwise empty sequence', async () => {
		const manager = new ShutdownManager(createMockLogger(), { hardTimeoutMs: 10 });
		const resultPromise = manager.execute('hard');

		blockEventLoop(25);

		await expect(resultPromise).resolves.toEqual({
			mode: 'hard',
			completed: false,
			failedHandlers: [],
		});
	});

	it('shares the in-flight promise and lets a concurrent hard call escalate graceful work', async () => {
		vi.useFakeTimers({ now: 0 });
		const logger = createMockLogger();
		const manager = new ShutdownManager(logger, { hardTimeoutMs: 500 });
		const receivedModes: ShutdownMode[] = [];
		let receivedSignal: AbortSignal | undefined;

		manager.register(
			'work',
			async (mode, _remainingTimeMs, signal) => {
				receivedModes.push(mode);
				receivedSignal = signal;
				await new Promise<void>((resolve) => {
					if (signal?.aborted) {
						resolve();
						return;
					}
					signal?.addEventListener('abort', () => resolve(), { once: true });
				});
			},
			10,
		);

		const graceful = manager.execute('graceful', 1_000);
		await Promise.resolve();
		await Promise.resolve();
		const hard = manager.execute('hard');

		expect(hard).toBe(graceful);
		await expect(graceful).resolves.toEqual({ mode: 'hard', completed: true, failedHandlers: [] });
		expect(receivedModes).toEqual(['graceful']);
		expect(receivedSignal?.aborted).toBe(true);
		expect(logger.warn).toHaveBeenCalledWith('Shutdown already in progress');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('reports handler failures and continues with later priorities', async () => {
		vi.useFakeTimers({ now: 0 });
		const manager = new ShutdownManager(createMockLogger());
		const laterHandler = vi.fn().mockResolvedValue(undefined);

		manager.register(
			'failing-handler',
			async () => {
				throw new Error('shutdown failed');
			},
			10,
		);
		manager.register('later-handler', laterHandler, 20);

		const result = await manager.execute('graceful');

		expect(laterHandler).toHaveBeenCalledOnce();
		expect(result).toEqual({ mode: 'graceful', completed: false, failedHandlers: ['failing-handler'] });
		expect(vi.getTimerCount()).toBe(0);
	});

	it('invokes every remaining handler without awaiting past the overall hard budget', async () => {
		vi.useFakeTimers({ now: 0 });
		const manager = new ShutdownManager(createMockLogger(), { hardTimeoutMs: 50 });
		const blockingWork = deferred<void>();
		const laterCalls: Array<{ name: string; mode: ShutdownMode; remainingTimeMs: number | undefined }> = [];

		manager.register(
			'blocking-handler',
			async () => {
				await blockingWork.promise;
			},
			10,
		);
		manager.register(
			'later-a',
			async (mode, remainingTimeMs) => {
				laterCalls.push({ name: 'later-a', mode, remainingTimeMs });
			},
			20,
		);
		manager.register(
			'later-b',
			async (mode, remainingTimeMs) => {
				laterCalls.push({ name: 'later-b', mode, remainingTimeMs });
			},
			30,
		);

		const resultPromise = manager.execute('hard');
		await vi.advanceTimersByTimeAsync(50);
		const result = await resultPromise;

		expect(result).toEqual({ mode: 'hard', completed: false, failedHandlers: [] });
		expect(laterCalls).toEqual([
			{ name: 'later-a', mode: 'hard', remainingTimeMs: 0 },
			{ name: 'later-b', mode: 'hard', remainingTimeMs: 0 },
		]);
		expect(vi.getTimerCount()).toBe(0);

		blockingWork.resolve(undefined);
		await Promise.resolve();
	});
});
