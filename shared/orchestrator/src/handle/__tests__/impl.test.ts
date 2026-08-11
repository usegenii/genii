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
	it('preserves an initially parked instance status without starting it', () => {
		const waitingRun = vi.fn(() =>
			(async function* (): AsyncIterable<AgentEvent> {
				// The restored iterator remains dormant until resolution.
			})(),
		);
		const waitingInstance = createInstance(waitingRun);
		vi.mocked(waitingInstance.status).mockReturnValue('waiting');

		const waitingHandle = new AgentHandleImpl(waitingInstance, {});
		const idleHandle = new AgentHandleImpl(
			createInstance(() =>
				(async function* (): AsyncIterable<AgentEvent> {
					// An ordinary new instance has not started yet.
				})(),
			),
			{},
		);

		expect(waitingHandle.status).toBe('waiting');
		expect(idleHandle.status).toBe('initializing');
		expect(waitingRun).not.toHaveBeenCalled();
	});

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

	it('keeps termination sticky when an aborted iterator yields late events', async () => {
		let releaseNext: (() => void) | undefined;
		const nextGate = new Promise<void>((resolve) => {
			releaseNext = resolve;
		});
		let markNextStarted: (() => void) | undefined;
		const nextStarted = new Promise<void>((resolve) => {
			markNextStarted = resolve;
		});
		let nextIndex = 0;
		const close = vi.fn(async () => ({ done: true as const, value: undefined }));
		const instance = createInstance(
			(): AsyncIterable<AgentEvent> => ({
				[Symbol.asyncIterator]: () => ({
					next: async () => {
						if (nextIndex === 0) {
							nextIndex++;
							markNextStarted?.();
							await nextGate;
							return {
								done: false as const,
								value: { type: 'status' as const, status: 'completed' as const, timestamp: Date.now() },
							};
						}
						if (nextIndex === 1) {
							nextIndex++;
							return {
								done: false as const,
								value: {
									type: 'done' as const,
									result: {
										status: 'completed' as const,
										metrics: { durationMs: 1, turns: 1, toolCalls: 0 },
									},
									timestamp: Date.now(),
								},
							};
						}
						return { done: true as const, value: undefined };
					},
					return: close,
				}),
			}),
		);
		vi.mocked(instance.abort).mockImplementation(() => releaseNext?.());
		const handle = new AgentHandleImpl(instance, {});
		const events: AgentEvent[] = [];
		handle.subscribe((event) => events.push(event));

		const activeRun = handle.start();
		await nextStarted;
		await handle.terminate('shutdown');
		await activeRun;

		expect(handle.status).toBe('terminated');
		expect(close).toHaveBeenCalledTimes(1);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: 'done',
			result: { status: 'terminated', error: 'shutdown' },
		});
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
