import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../logging/logger';
import { ShutdownManager, type ShutdownMode } from '../manager';

/**
 * Create a minimal mock logger for testing.
 */
function createMockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(() => createMockLogger()),
	} as unknown as Logger;
}

describe('ShutdownManager', () => {
	describe('register()', () => {
		it('should register a shutdown handler', () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);
			const handler = vi.fn().mockResolvedValue(undefined);

			manager.register('test-handler', handler, 10);

			expect(logger.debug).toHaveBeenCalledWith(
				{ name: 'test-handler', priority: 10 },
				'Registered shutdown handler',
			);
		});

		it('should warn when replacing an existing handler', () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);
			const handler1 = vi.fn().mockResolvedValue(undefined);
			const handler2 = vi.fn().mockResolvedValue(undefined);

			manager.register('test-handler', handler1, 10);
			manager.register('test-handler', handler2, 20);

			expect(logger.warn).toHaveBeenCalledWith({ name: 'test-handler' }, 'Replacing existing shutdown handler');
		});
	});

	describe('unregister()', () => {
		it('should unregister a handler', async () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);
			const handler = vi.fn().mockResolvedValue(undefined);

			manager.register('test-handler', handler, 10);
			manager.unregister('test-handler');

			await manager.execute('graceful');

			expect(handler).not.toHaveBeenCalled();
		});

		it('should handle unregistering non-existent handler gracefully', () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);

			expect(() => manager.unregister('non-existent')).not.toThrow();
		});
	});

	describe('execute()', () => {
		it('should execute handlers in priority order (lower first)', async () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);
			const executionOrder: number[] = [];

			manager.register(
				'priority-30',
				async () => {
					executionOrder.push(30);
				},
				30,
			);
			manager.register(
				'priority-10',
				async () => {
					executionOrder.push(10);
				},
				10,
			);
			manager.register(
				'priority-20',
				async () => {
					executionOrder.push(20);
				},
				20,
			);

			await manager.execute('graceful');

			expect(executionOrder).toEqual([10, 20, 30]);
		});

		it('should execute handlers with same priority in parallel', async () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);
			let startA = 0;
			let startB = 0;

			manager.register(
				'handler-a',
				async () => {
					startA = Date.now();
					await new Promise((resolve) => setTimeout(resolve, 50));
				},
				10,
			);
			manager.register(
				'handler-b',
				async () => {
					startB = Date.now();
					await new Promise((resolve) => setTimeout(resolve, 50));
				},
				10,
			);

			await manager.execute('graceful');

			// If running in parallel, both should start at nearly the same time
			const startDiff = Math.abs(startA - startB);
			expect(startDiff).toBeLessThan(20); // Allow for small timing variance
		});

		it('should pass shutdown mode to handlers', async () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);
			const receivedModes: ShutdownMode[] = [];

			manager.register(
				'test-handler',
				async (mode) => {
					receivedModes.push(mode);
				},
				10,
			);

			await manager.execute('graceful');
			await manager.unregister('test-handler');

			// Reset for second test
			const manager2 = new ShutdownManager(logger);
			manager2.register(
				'test-handler',
				async (mode) => {
					receivedModes.push(mode);
				},
				10,
			);
			await manager2.execute('hard');

			expect(receivedModes).toEqual(['graceful', 'hard']);
		});

		it('should continue with other handlers when one throws an error', async () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);
			const handlerCalled = { a: false, b: false, c: false };

			manager.register(
				'handler-a',
				async () => {
					handlerCalled.a = true;
				},
				10,
			);
			manager.register(
				'handler-b',
				async () => {
					handlerCalled.b = true;
					throw new Error('Test error');
				},
				20,
			);
			manager.register(
				'handler-c',
				async () => {
					handlerCalled.c = true;
				},
				30,
			);

			await manager.execute('graceful');

			expect(handlerCalled.a).toBe(true);
			expect(handlerCalled.b).toBe(true);
			expect(handlerCalled.c).toBe(true);
			expect(logger.error).toHaveBeenCalled();
		});

		it('should not execute if already shutting down', async () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);
			let callCount = 0;

			manager.register(
				'test-handler',
				async () => {
					callCount++;
					await new Promise((resolve) => setTimeout(resolve, 50));
				},
				10,
			);

			// Start two shutdown sequences
			const promise1 = manager.execute('graceful');
			const promise2 = manager.execute('graceful');

			await Promise.all([promise1, promise2]);

			expect(callCount).toBe(1);
			expect(logger.warn).toHaveBeenCalledWith('Shutdown already in progress');
		});
	});

	describe('graceful vs hard shutdown mode', () => {
		it('should wait for all handlers in graceful mode', async () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);
			const completed: string[] = [];

			manager.register(
				'slow-handler',
				async () => {
					await new Promise((resolve) => setTimeout(resolve, 100));
					completed.push('slow');
				},
				10,
			);
			manager.register(
				'fast-handler',
				async () => {
					await new Promise((resolve) => setTimeout(resolve, 10));
					completed.push('fast');
				},
				10,
			);

			await manager.execute('graceful');

			expect(completed).toContain('slow');
			expect(completed).toContain('fast');
		});

		it('should timeout in hard mode per priority level', async () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger, { hardTimeoutMs: 50 });
			const completed: string[] = [];

			manager.register(
				'very-slow-handler',
				async () => {
					await new Promise((resolve) => setTimeout(resolve, 200));
					completed.push('very-slow');
				},
				10,
			);
			manager.register(
				'fast-handler',
				async () => {
					await new Promise((resolve) => setTimeout(resolve, 10));
					completed.push('fast');
				},
				20,
			);

			await manager.execute('hard');

			// Fast handler in priority 20 should complete
			expect(completed).toContain('fast');
			// Very slow handler should have been timed out
			expect(logger.warn).toHaveBeenCalled();
		});
	});

	describe('isShuttingDown', () => {
		it('should return false initially', () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);

			expect(manager.isShuttingDown).toBe(false);
		});

		it('should return true during shutdown', async () => {
			const logger = createMockLogger();
			const manager = new ShutdownManager(logger);
			let wasShuttingDownDuringHandler = false;

			manager.register(
				'test-handler',
				async () => {
					wasShuttingDownDuringHandler = manager.isShuttingDown;
				},
				10,
			);

			await manager.execute('graceful');

			expect(wasShuttingDownDuringHandler).toBe(true);
			expect(manager.isShuttingDown).toBe(true);
		});
	});
});
