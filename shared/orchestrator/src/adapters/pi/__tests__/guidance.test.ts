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

	it('tracks concurrent wrapper invocations independently by tool-call ID', async () => {
		const gates = new Map<string, ReturnType<typeof createDeferred<StepResumeData>>>();
		const seen = createDeferred<void>();
		const tracker = createToolExecutionTracker();
		const tool: Tool<unknown, string> = {
			name: 'input',
			description: 'waits for input',
			parameters: Type.Object({ value: Type.String() }),
			canSuspend: true,
			execute: async (input, context) => {
				const { value: prompt } = input as { value: string };
				const value = await context.step.waitForUserInput<string>({ prompt });
				return { status: 'success', output: value };
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
				if (gates.size === 2) seen.resolve();
				return gate.promise;
			},
		);
		if (!piTool) throw new Error('Expected converted tool');

		const first = piTool.execute('call-a', { value: 'a' });
		const second = piTool.execute('call-b', { value: 'b' });
		await seen.promise;
		expect([...tracker.executions.keys()].sort()).toEqual(['call-a', 'call-b']);

		for (const [toolCallId, gate] of gates) {
			gate.resolve({
				stepId: `__suspension:user_input:0`,
				outcome: { type: 'value', value: toolCallId },
			});
		}
		await expect(Promise.all([first, second])).resolves.toMatchObject([
			{ content: [{ text: 'call-a' }] },
			{ content: [{ text: 'call-b' }] },
		]);
	});
});
