import { describe, expect, it, vi } from 'vitest';
import type { AgentInstance } from '../../adapters/types';
import type { AgentEvent } from '../../events/types';
import { AgentHandleImpl } from '../impl';

function createInstance(run: () => AsyncIterable<AgentEvent>): AgentInstance {
	return {
		id: 'test-session',
		run,
		send: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		abort: vi.fn(),
		checkpoint: vi.fn(),
		status: vi.fn().mockReturnValue('idle'),
		getPendingRequests: vi.fn().mockReturnValue([]),
		resolve: vi.fn(),
	} as unknown as AgentInstance;
}

describe('AgentHandleImpl.start', () => {
	it('derives terminal status from a done result', async () => {
		const handle = new AgentHandleImpl(
			createInstance(() =>
				(async function* (): AsyncIterable<AgentEvent> {
					yield {
						type: 'done',
						result: {
							status: 'failed',
							error: 'checkpoint failed',
							metrics: { durationMs: 1, turns: 1, toolCalls: 1 },
						},
						timestamp: Date.now(),
					};
				})(),
			),
			{},
		);

		await handle.start();

		expect(handle.status).toBe('failed');
	});

	it('can restart after the instance event iterator completes', async () => {
		const run = vi.fn(() =>
			(async function* (): AsyncIterable<AgentEvent> {
				yield {
					type: 'status',
					status: 'waiting',
					timestamp: Date.now(),
				};
			})(),
		);
		const handle = new AgentHandleImpl(createInstance(run), {});

		await handle.start();
		await handle.start();

		expect(run).toHaveBeenCalledTimes(2);
	});

	it('can restart after the instance event iterator throws', async () => {
		const run = vi.fn(
			(): AsyncIterable<AgentEvent> => ({
				[Symbol.asyncIterator]: () => ({
					next: async () => {
						throw new Error('event loop failed');
					},
				}),
			}),
		);
		const handle = new AgentHandleImpl(createInstance(run), {});
		const errors: AgentEvent[] = [];
		handle.subscribe((event) => {
			if (event.type === 'error') errors.push(event);
		});

		await handle.start();
		await handle.start();

		expect(run).toHaveBeenCalledTimes(2);
		expect(errors).toHaveLength(2);
		expect(errors[0]).toMatchObject({
			type: 'error',
			error: 'event loop failed',
			fatal: true,
		});
	});

	it('does not start a second event iterator while one is active', async () => {
		let release: (() => void) | undefined;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const run = vi.fn(
			(): AsyncIterable<AgentEvent> => ({
				[Symbol.asyncIterator]: () => ({
					next: async () => {
						await blocked;
						return { done: true, value: undefined };
					},
				}),
			}),
		);
		const handle = new AgentHandleImpl(createInstance(run), {});

		const firstRun = handle.start();
		const duplicateRun = handle.start();

		expect(run).toHaveBeenCalledTimes(1);
		release?.();
		await Promise.all([firstRun, duplicateRun]);
	});
});

describe('AgentHandleImpl.send', () => {
	it('rejects ordinary input while a suspension is pending', async () => {
		const instance = createInstance(() =>
			(async function* (): AsyncIterable<AgentEvent> {
				yield { type: 'status', status: 'waiting', timestamp: Date.now() };
			})(),
		);
		const handle = new AgentHandleImpl(instance, {});
		await handle.start();

		await expect(handle.send({ message: 'ordinary chat input' })).rejects.toThrow(
			'waiting for a suspension resolution',
		);
		expect(instance.send).not.toHaveBeenCalled();
	});
});
