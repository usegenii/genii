import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi } from 'vitest';
import type { GuidanceContext } from '../../../guidance/types';
import { createSuspensionId, normalizeSuspensionResolution } from '../../../tools/suspension';
import type { StepResumeData, Tool } from '../../../tools/types';
import { buildPiTools, createToolExecutionTracker, type ToolSuspensionContext } from '../guidance';

const guidance = {} as GuidanceContext;

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe('Pi durable tool wrapper', () => {
	it('parks a suspension, propagates its real step ID, and memoizes pre-wait work during replay', async () => {
		const sideEffect = vi.fn(async () => 'prepared');
		const suspended = createDeferred<ToolSuspensionContext>();
		const resume = createDeferred<StepResumeData>();
		const tracker = createToolExecutionTracker();
		const tool: Tool<unknown, unknown> = {
			name: 'wait-for-build',
			description: 'waits for a build',
			parameters: Type.Object({}),
			canSuspend: true,
			execute: async (_input, context) => {
				const prepared = await context.step.run('prepare', sideEffect);
				const payload = await context.step.waitForEvent('build.finished');
				return { status: 'success', output: { prepared, payload } };
			},
		};
		const [piTool] = buildPiTools(
			[tool],
			'session-1',
			guidance,
			new AbortController().signal,
			tracker,
			undefined,
			async (context) => {
				suspended.resolve(context);
				return resume.promise;
			},
		);
		if (!piTool) throw new Error('Expected converted tool');

		let settled = false;
		const execution = piTool.execute('call-1', {}).then((result) => {
			settled = true;
			return result;
		});
		const suspension = await suspended.promise;

		expect(suspension.stepId).toBe('__suspension:event:build.finished:0');
		expect(suspension.completedSteps.map((step) => step.stepId)).toEqual(['prepare']);
		expect(sideEffect).toHaveBeenCalledTimes(1);
		expect(tracker.executions.get('call-1')?.stepContext).toBeDefined();
		await Promise.resolve();
		expect(settled).toBe(false);

		resume.resolve(
			normalizeSuspensionResolution(suspension.stepId, suspension.request, {
				suspensionId: createSuspensionId('call-1', suspension.stepId),
				type: 'event',
				payload: false,
			}),
		);

		await expect(execution).resolves.toMatchObject({
			content: [{ type: 'text', text: expect.stringContaining('false') }],
		});
		expect(sideEffect).toHaveBeenCalledTimes(1);
		expect(tracker.executions.size).toBe(0);
	});

	it('supports sequential suspensions in one invocation', async () => {
		const suspensions: ToolSuspensionContext[] = [];
		const tool: Tool<unknown, unknown> = {
			name: 'two-events',
			description: 'waits twice',
			parameters: Type.Object({}),
			canSuspend: true,
			execute: async (_input, context) => {
				const first = await context.step.waitForEvent('first');
				const second = await context.step.waitForEvent('second');
				return { status: 'success', output: [first, second] };
			},
		};
		const [piTool] = buildPiTools(
			[tool],
			'session-1',
			guidance,
			new AbortController().signal,
			createToolExecutionTracker(),
			undefined,
			async (suspension) => {
				suspensions.push(suspension);
				return normalizeSuspensionResolution(suspension.stepId, suspension.request, {
					suspensionId: createSuspensionId(suspension.toolCallId, suspension.stepId),
					type: 'event',
					payload: suspension.request.type === 'event' ? suspension.request.eventName : null,
				});
			},
		);
		if (!piTool) throw new Error('Expected converted tool');

		const result = await piTool.execute('call-1', {});

		expect(suspensions.map((suspension) => suspension.stepId)).toEqual([
			'__suspension:event:first:0',
			'__suspension:event:second:0',
		]);
		expect(result.content).toEqual([{ type: 'text', text: '[\n  "first",\n  "second"\n]' }]);
	});

	it('keeps per-call input and completed steps isolated during reverse-order completion', async () => {
		const releases = new Map([
			['alpha', createDeferred<void>()],
			['beta', createDeferred<void>()],
		]);
		const bothStarted = createDeferred<void>();
		const completionOrder: string[] = [];
		const completions: Array<{
			toolCallId: string;
			input: unknown;
			completedValues: unknown[];
		}> = [];
		const tracker = createToolExecutionTracker();
		const tool: Tool<unknown, string> = {
			name: 'reverse-order',
			description: 'finishes calls in a controlled order',
			parameters: Type.Object({ value: Type.String() }),
			execute: async (input, context) => {
				const { value } = input as { value: string };
				const ownedValue = await context.step.run('capture-input', async () => value);
				if (tracker.executions.size === 2) bothStarted.resolve();
				await releases.get(value)?.promise;
				return { status: 'success', output: ownedValue };
			},
		};
		const [piTool] = buildPiTools(
			[tool],
			'session-1',
			guidance,
			new AbortController().signal,
			tracker,
			undefined,
			undefined,
			undefined,
			async (completion) => {
				completionOrder.push(completion.toolCallId);
				completions.push({
					toolCallId: completion.toolCallId,
					input: completion.input,
					completedValues: completion.completedSteps.map((step) => step.result),
				});
			},
		);
		if (!piTool) throw new Error('Expected converted tool');

		let alphaSettled = false;
		const alpha = piTool.execute('call-alpha', { value: 'alpha' }).then((result) => {
			alphaSettled = true;
			return result;
		});
		const beta = piTool.execute('call-beta', { value: 'beta' });
		await bothStarted.promise;

		expect(tracker.executions.get('call-alpha')).toMatchObject({
			input: { value: 'alpha' },
			completedSteps: [],
		});
		expect(tracker.executions.get('call-beta')).toMatchObject({
			input: { value: 'beta' },
			completedSteps: [],
		});

		releases.get('beta')?.resolve();
		await expect(beta).resolves.toMatchObject({ content: [{ text: 'beta' }] });
		expect(alphaSettled).toBe(false);
		expect([...tracker.executions.keys()]).toEqual(['call-alpha']);

		releases.get('alpha')?.resolve();
		await expect(alpha).resolves.toMatchObject({ content: [{ text: 'alpha' }] });
		expect(completionOrder).toEqual(['call-beta', 'call-alpha']);
		expect(completions).toEqual([
			{
				toolCallId: 'call-beta',
				input: { value: 'beta' },
				completedValues: ['beta'],
			},
			{
				toolCallId: 'call-alpha',
				input: { value: 'alpha' },
				completedValues: ['alpha'],
			},
		]);
		expect(tracker.executions.size).toBe(0);
	});

	it('parks one suspended wrapper while its sibling completes', async () => {
		const suspended = createDeferred<ToolSuspensionContext>();
		const resume = createDeferred<StepResumeData>();
		const siblingCompleted = createDeferred<void>();
		const completionOrder: string[] = [];
		const tracker = createToolExecutionTracker();
		const tool: Tool<unknown, string> = {
			name: 'mixed-batch',
			description: 'sometimes waits and sometimes completes',
			parameters: Type.Object({ value: Type.String(), suspend: Type.Boolean() }),
			canSuspend: true,
			execute: async (input, context) => {
				const { suspend, value } = input as { suspend: boolean; value: string };
				if (!suspend) {
					return { status: 'success', output: await context.step.run('complete', async () => value) };
				}
				const payload = await context.step.waitForEvent<string>(`resume-${value}`);
				return { status: 'success', output: `${value}:${payload}` };
			},
		};
		const [piTool] = buildPiTools(
			[tool],
			'session-1',
			guidance,
			new AbortController().signal,
			tracker,
			undefined,
			async (context) => {
				suspended.resolve(context);
				return resume.promise;
			},
			undefined,
			async (completion) => {
				completionOrder.push(completion.toolCallId);
				if (completion.toolCallId === 'call-sibling') siblingCompleted.resolve();
			},
		);
		if (!piTool) throw new Error('Expected converted tool');

		let waitingSettled = false;
		const waiting = piTool.execute('call-waiting', { value: 'waiting', suspend: true }).then((result) => {
			waitingSettled = true;
			return result;
		});
		const sibling = piTool.execute('call-sibling', { value: 'sibling', suspend: false });
		const suspension = await suspended.promise;
		await siblingCompleted.promise;

		await expect(sibling).resolves.toMatchObject({ content: [{ text: 'sibling' }] });
		expect(waitingSettled).toBe(false);
		expect([...tracker.executions.keys()]).toEqual(['call-waiting']);
		expect(suspension).toMatchObject({
			toolCallId: 'call-waiting',
			input: { value: 'waiting', suspend: true },
			stepId: '__suspension:event:resume-waiting:0',
		});

		resume.resolve(
			normalizeSuspensionResolution(suspension.stepId, suspension.request, {
				suspensionId: createSuspensionId(suspension.toolCallId, suspension.stepId),
				type: 'event',
				payload: 'released',
			}),
		);
		await expect(waiting).resolves.toMatchObject({ content: [{ text: 'waiting:released' }] });
		expect(completionOrder).toEqual(['call-sibling', 'call-waiting']);
		expect(tracker.executions.size).toBe(0);
	});

	it('resolves two concurrent suspensions in reverse order without crossing call state', async () => {
		const gates = new Map<string, ReturnType<typeof createDeferred<StepResumeData>>>();
		const suspensions = new Map<string, ToolSuspensionContext>();
		const seen = createDeferred<void>();
		const tracker = createToolExecutionTracker();
		const tool: Tool<unknown, string> = {
			name: 'input',
			description: 'waits for input',
			parameters: Type.Object({ value: Type.String() }),
			canSuspend: true,
			execute: async (input, context) => {
				const { value: prompt } = input as { value: string };
				const prepared = await context.step.run('prepare', async () => prompt);
				const value = await context.step.waitForUserInput<string>({ prompt });
				return { status: 'success', output: `${prepared}:${value}` };
			},
		};
		const [piTool] = buildPiTools(
			[tool],
			'session-1',
			guidance,
			new AbortController().signal,
			tracker,
			undefined,
			async (suspension) => {
				const gate = createDeferred<StepResumeData>();
				gates.set(suspension.toolCallId, gate);
				suspensions.set(suspension.toolCallId, suspension);
				if (gates.size === 2) seen.resolve();
				return gate.promise;
			},
		);
		if (!piTool) throw new Error('Expected converted tool');

		let firstSettled = false;
		const first = piTool.execute('call-a', { value: 'a' }).then((result) => {
			firstSettled = true;
			return result;
		});
		const second = piTool.execute('call-b', { value: 'b' });
		await seen.promise;
		expect([...tracker.executions.keys()].sort()).toEqual(['call-a', 'call-b']);
		expect(suspensions.get('call-a')).toMatchObject({
			input: { value: 'a' },
			completedSteps: [{ stepId: 'prepare', result: 'a' }],
		});
		expect(suspensions.get('call-b')).toMatchObject({
			input: { value: 'b' },
			completedSteps: [{ stepId: 'prepare', result: 'b' }],
		});

		gates.get('call-b')?.resolve({
			stepId: '__suspension:user_input:0',
			outcome: { type: 'value', value: 'answer-b' },
		});
		await expect(second).resolves.toMatchObject({ content: [{ text: 'b:answer-b' }] });
		expect(firstSettled).toBe(false);
		expect([...tracker.executions.keys()]).toEqual(['call-a']);

		gates.get('call-a')?.resolve({
			stepId: '__suspension:user_input:0',
			outcome: { type: 'value', value: 'answer-a' },
		});
		await expect(first).resolves.toMatchObject({ content: [{ text: 'a:answer-a' }] });
		expect(tracker.executions.size).toBe(0);
	});

	it('applies cancellation only to its targeted suspended call', async () => {
		const gates = new Map<string, ReturnType<typeof createDeferred<StepResumeData>>>();
		const suspensions = new Map<string, ToolSuspensionContext>();
		const bothSuspended = createDeferred<void>();
		const tracker = createToolExecutionTracker();
		const tool: Tool<unknown, string> = {
			name: 'targeted-cancel',
			description: 'waits for independently targeted input',
			parameters: Type.Object({ value: Type.String() }),
			canSuspend: true,
			execute: async (input, context) => {
				const { value } = input as { value: string };
				await context.step.run('prepare', async () => value);
				const answer = await context.step.waitForUserInput<string>({ prompt: value });
				return { status: 'success', output: `${value}:${answer}` };
			},
		};
		const [piTool] = buildPiTools(
			[tool],
			'session-1',
			guidance,
			new AbortController().signal,
			tracker,
			undefined,
			async (suspension) => {
				const gate = createDeferred<StepResumeData>();
				gates.set(suspension.toolCallId, gate);
				suspensions.set(suspension.toolCallId, suspension);
				if (gates.size === 2) bothSuspended.resolve();
				return gate.promise;
			},
		);
		if (!piTool) throw new Error('Expected converted tool');

		const cancelled = piTool.execute('call-cancelled', { value: 'cancelled' });
		const continuing = piTool.execute('call-continuing', { value: 'continuing' });
		await bothSuspended.promise;
		const cancelledSuspension = suspensions.get('call-cancelled');
		const continuingSuspension = suspensions.get('call-continuing');
		if (!cancelledSuspension || !continuingSuspension) throw new Error('Expected both suspensions');

		gates.get('call-cancelled')?.resolve(
			normalizeSuspensionResolution(cancelledSuspension.stepId, cancelledSuspension.request, {
				suspensionId: createSuspensionId(cancelledSuspension.toolCallId, cancelledSuspension.stepId),
				type: 'cancel',
				reason: 'cancel only this call',
			}),
		);
		gates.get('call-continuing')?.resolve(
			normalizeSuspensionResolution(continuingSuspension.stepId, continuingSuspension.request, {
				suspensionId: createSuspensionId(continuingSuspension.toolCallId, continuingSuspension.stepId),
				type: 'user_input',
				value: 'accepted',
			}),
		);

		await expect(cancelled).resolves.toMatchObject({
			content: [{ text: expect.stringContaining('cancel only this call') }],
		});
		await expect(continuing).resolves.toMatchObject({ content: [{ text: 'continuing:accepted' }] });
		expect(tracker.executions.size).toBe(0);
	});

	it('propagates a whole-session abort to every overlapping wrapper', async () => {
		const abortController = new AbortController();
		const bothStarted = createDeferred<void>();
		const started: string[] = [];
		const observedSignals: AbortSignal[] = [];
		const tracker = createToolExecutionTracker();
		const tool: Tool<unknown, string> = {
			name: 'abort-batch',
			description: 'waits until the session aborts',
			parameters: Type.Object({ value: Type.String() }),
			execute: async (input, context) => {
				const { value } = input as { value: string };
				started.push(value);
				observedSignals.push(context.signal);
				if (started.length === 2) bothStarted.resolve();
				await new Promise<never>((_resolve, reject) => {
					const rejectForAbort = () => reject(new Error(`aborted:${value}`));
					if (context.signal.aborted) {
						rejectForAbort();
						return;
					}
					context.signal.addEventListener('abort', rejectForAbort, { once: true });
				});
				throw new Error('unreachable');
			},
		};
		const [piTool] = buildPiTools([tool], 'session-1', guidance, abortController.signal, tracker);
		if (!piTool) throw new Error('Expected converted tool');

		const first = piTool.execute('call-a', { value: 'a' });
		const second = piTool.execute('call-b', { value: 'b' });
		await bothStarted.promise;
		abortController.abort();

		await expect(Promise.all([first, second])).resolves.toMatchObject([
			{ content: [{ text: 'aborted:a' }] },
			{ content: [{ text: 'aborted:b' }] },
		]);
		expect(observedSignals).toEqual([abortController.signal, abortController.signal]);
		expect(tracker.executions.size).toBe(0);
	});
});
