import { describe, expect, it, vi } from 'vitest';
import { LogBuffer } from './buffer';
import { attachLogBuffer, createLogger } from './logger';

describe('LogBuffer', () => {
	it('keeps a bounded sequenced history and notifies listeners', () => {
		const buffer = new LogBuffer(2);
		const listener = vi.fn();
		const unsubscribe = buffer.subscribe(listener);

		buffer.append({ timestamp: 1, level: 'debug', message: 'first' });
		buffer.append({ timestamp: 2, level: 'info', message: 'second' });
		buffer.append({ timestamp: 3, level: 'error', message: 'third' });

		expect(buffer.recent().map((entry) => entry.sequence)).toEqual([2, 3]);
		expect(listener).toHaveBeenCalledTimes(3);
		unsubscribe();
		buffer.append({ timestamp: 4, level: 'info', message: 'fourth' });
		expect(listener).toHaveBeenCalledTimes(3);
	});

	it('filters replay by minimum level, component, since, and limit', () => {
		const buffer = new LogBuffer(10);
		buffer.append({ timestamp: 1_000, level: 'debug', component: 'worker', message: 'debug' });
		buffer.append({ timestamp: 2_000, level: 'warn', component: 'rpc', message: 'warning' });
		buffer.append({ timestamp: 3_000, level: 'error', component: 'rpc', message: 'failure' });

		expect(buffer.recent({ level: 'warn', component: 'rpc', since: 1_500, limit: 1 })).toMatchObject([
			{ sequence: 3, message: 'failure' },
		]);
		expect(buffer.recent({ limit: 0 })).toEqual([]);
	});

	it('captures normalized entries from child loggers', () => {
		const buffer = new LogBuffer(10);
		const logger = createLogger({ level: 'info', logBuffer: buffer });
		logger.child({ component: 'Worker' }).info({ jobId: 'job-1' }, 'Job started');

		expect(buffer.recent()).toMatchObject([
			{
				sequence: 1,
				level: 'info',
				component: 'Worker',
				message: 'Job started',
				data: { jobId: 'job-1' },
			},
		]);
	});

	it('attaches a buffer to an injected logger without capturing disabled levels twice', () => {
		const buffer = new LogBuffer(10);
		const injected = createLogger({ level: 'warn' });
		const attached = attachLogBuffer(injected, buffer);
		const attachedAgain = attachLogBuffer(attached, buffer);

		expect(attachedAgain).toBe(attached);
		attachedAgain.child({ component: 'Injected' }).info('disabled');
		attachedAgain.child({ component: 'Injected' }).warn('captured');

		expect(buffer.recent()).toMatchObject([
			{
				sequence: 1,
				level: 'warn',
				component: 'Injected',
				message: 'captured',
			},
		]);
	});
});
