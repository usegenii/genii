/**
 * Tests for StepContext.
 */

import { describe, expect, it, vi } from 'vitest';
import { createStepContext, StepContextImpl } from '../step-context';
import { DuplicateStepError, SuspensionError } from '../suspension';
import type { StepContextEvent } from '../types';

describe('StepContext', () => {
	describe('createStepContext', () => {
		it('should create a new step context', () => {
			const context = createStepContext();
			expect(context).toBeInstanceOf(StepContextImpl);
		});

		it('should accept options', () => {
			const completedSteps = [{ stepId: 'step1', result: 'value1', completedAt: Date.now() }];
			const context = createStepContext({ completedSteps });
			expect(context.hasCompletedStep('step1')).toBe(true);
		});
	});

	describe('run', () => {
		it('should execute the function and return result', async () => {
			const context = createStepContext();
			const result = await context.run('step1', async () => 'hello');
			expect(result).toBe('hello');
		});

		it('should memoize results', async () => {
			const fn = vi.fn().mockResolvedValue('result');
			const completedSteps = [{ stepId: 'step1', result: 'memoized', completedAt: Date.now() }];
			const context = createStepContext({ completedSteps });

			const result = await context.run('step1', fn);
			expect(result).toBe('memoized');
			expect(fn).not.toHaveBeenCalled();
		});

		it('should throw DuplicateStepError for duplicate step IDs in same run', async () => {
			const context = createStepContext();
			await context.run('step1', async () => 'first');

			await expect(context.run('step1', async () => 'second')).rejects.toThrow(DuplicateStepError);
		});

		it('should emit step_start and step_end events', async () => {
			const events: StepContextEvent[] = [];
			const context = createStepContext({
				onEvent: (event) => events.push(event),
			});

			await context.run('step1', async () => 'result');

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({ type: 'step_start', stepId: 'step1' });
			expect(events[1]).toEqual({ type: 'step_end', stepId: 'step1', result: 'result' });
		});

		it('should emit step_memoized event for memoized steps', async () => {
			const events: StepContextEvent[] = [];
			const completedSteps = [{ stepId: 'step1', result: 'memoized', completedAt: Date.now() }];
			const context = createStepContext({
				completedSteps,
				onEvent: (event) => events.push(event),
			});

			await context.run('step1', async () => 'new result');

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({ type: 'step_memoized', stepId: 'step1', result: 'memoized' });
		});

		it('should use resume data for suspended steps', async () => {
			const context = createStepContext({
				resumeData: { stepId: 'step1', result: 'resumed' },
			});

			const result = await context.run('step1', async () => 'should not be called');
			expect(result).toBe('resumed');
		});
	});

	describe('waitForUserInput', () => {
		it('should throw SuspensionError', async () => {
			const context = createStepContext();

			await expect(context.waitForUserInput({ prompt: 'Enter value' })).rejects.toThrow(SuspensionError);
		});

		it('should emit suspended event', async () => {
			const events: StepContextEvent[] = [];
			const context = createStepContext({
				onEvent: (event) => events.push(event),
			});

			try {
				await context.waitForUserInput({ prompt: 'Enter value' });
			} catch (_e) {
				// Expected
			}

			const suspendedEvent = events.find((e) => e.type === 'suspended');
			expect(suspendedEvent).toBeDefined();
			expect(suspendedEvent?.type === 'suspended' && suspendedEvent.request.type).toBe('user_input');
		});
	});

	describe('waitForApproval', () => {
		it('should throw SuspensionError', async () => {
			const context = createStepContext();

			await expect(context.waitForApproval({ action: 'delete', description: 'Delete file' })).rejects.toThrow(
				SuspensionError,
			);
		});
	});

	describe('waitForEvent', () => {
		it('should throw SuspensionError', async () => {
			const context = createStepContext();

			await expect(context.waitForEvent('some-event')).rejects.toThrow(SuspensionError);
		});
	});

	describe('sleep', () => {
		it('should throw SuspensionError', async () => {
			const context = createStepContext();

			await expect(context.sleep(1000)).rejects.toThrow(SuspensionError);
		});
	});

	describe('getCompletedSteps', () => {
		it('should return completed steps', async () => {
			const context = createStepContext();
			await context.run('step1', async () => 'result1');
			await context.run('step2', async () => 'result2');

			const completed = context.getCompletedSteps();
			expect(completed).toHaveLength(2);
			expect(completed[0]?.stepId).toBe('step1');
			expect(completed[0]?.result).toBe('result1');
			expect(completed[1]?.stepId).toBe('step2');
			expect(completed[1]?.result).toBe('result2');
		});
	});

	describe('hasCompletedStep', () => {
		it('should return true for completed steps', async () => {
			const context = createStepContext();
			await context.run('step1', async () => 'result');

			expect(context.hasCompletedStep('step1')).toBe(true);
			expect(context.hasCompletedStep('step2')).toBe(false);
		});
	});

	describe('getCompletedStepResult', () => {
		it('should return the result of a completed step', async () => {
			const context = createStepContext();
			await context.run('step1', async () => 'result1');

			expect(context.getCompletedStepResult('step1')).toBe('result1');
			expect(context.getCompletedStepResult('nonexistent')).toBeUndefined();
		});
	});
});
