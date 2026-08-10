/**
 * Step context implementation for durable tool execution.
 */

import { DuplicateStepError, SuspensionCancelledError, SuspensionError, SuspensionTimeoutError } from './suspension';
import type {
	ApprovalRequest,
	ApprovalResponse,
	CompletedStep,
	StepContext,
	StepContextOptions,
	StepResumeData,
	SuspensionRequest,
	UserInputRequest,
	WaitOptions,
} from './types';

/**
 * Implementation of StepContext for durable execution.
 *
 * This class tracks completed steps for memoization and handles
 * suspension/resume for long-running tools.
 *
 * Execution flow:
 * 1. On first run, steps execute normally and results are stored
 * 2. On suspension, a SuspensionError is thrown to unwind the stack
 * 3. On resume, completed steps return memoized results
 * 4. The suspended step receives its resume data
 */
export class StepContextImpl implements StepContext {
	private completedSteps: Map<string, CompletedStep>;
	private executedSteps: Set<string>;
	private resumeData?: StepResumeData;
	private onEvent?: StepContextOptions['onEvent'];

	constructor(options: StepContextOptions = {}) {
		this.completedSteps = new Map(options.completedSteps?.map((step) => [step.stepId, { ...step }]));
		this.executedSteps = new Set();
		this.resumeData = options.resumeData;
		this.onEvent = options.onEvent;
	}

	/**
	 * Run a step with memoization.
	 */
	async run<T>(stepId: string, fn: () => Promise<T>): Promise<T> {
		// Check for duplicate execution in this run
		if (this.executedSteps.has(stepId)) {
			throw new DuplicateStepError(stepId);
		}

		// Mark as executed for this run
		this.executedSteps.add(stepId);

		// Check if we have a memoized result
		if (this.completedSteps.has(stepId)) {
			const result = this.completedSteps.get(stepId)?.result as T;
			this.onEvent?.({ type: 'step_memoized', stepId, result });
			return result;
		}

		// Check if this is the step being resumed
		if (this.resumeData?.stepId === stepId) {
			const outcome = this.resumeData.outcome;
			if (outcome.type === 'cancelled') {
				throw new SuspensionCancelledError(stepId, outcome.reason);
			}
			if (outcome.type === 'timeout') {
				throw new SuspensionTimeoutError(stepId);
			}
			const result = (outcome.type === 'void' ? undefined : outcome.value) as T;
			// Store for future memoization
			this.completedSteps.set(stepId, { stepId, result, completedAt: Date.now() });
			this.onEvent?.({ type: 'step_end', stepId, result });
			// Clear resume data so it's not reused
			this.resumeData = undefined;
			return result;
		}

		// Execute the step
		this.onEvent?.({ type: 'step_start', stepId });

		const result = await fn();
		this.completedSteps.set(stepId, { stepId, result, completedAt: Date.now() });
		this.onEvent?.({ type: 'step_end', stepId, result });
		return result;
	}

	/**
	 * Wait for user input (suspends execution).
	 */
	async waitForUserInput<T = unknown>(request: UserInputRequest): Promise<T> {
		const stepId = this.generateSuspensionStepId('user_input');
		return this.run(stepId, async () => {
			const suspensionRequest: SuspensionRequest = {
				type: 'user_input',
				request,
			};
			this.onEvent?.({ type: 'suspended', stepId, request: suspensionRequest });
			throw new SuspensionError(stepId, suspensionRequest);
		});
	}

	/**
	 * Wait for approval (suspends execution).
	 */
	async waitForApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
		const stepId = this.generateSuspensionStepId('approval');
		return this.run(stepId, async () => {
			const suspensionRequest: SuspensionRequest = {
				type: 'approval',
				request,
			};
			this.onEvent?.({ type: 'suspended', stepId, request: suspensionRequest });
			throw new SuspensionError(stepId, suspensionRequest);
		});
	}

	/**
	 * Wait for an external event (suspends execution).
	 */
	async waitForEvent<T = unknown>(eventName: string, options?: WaitOptions): Promise<T | null> {
		const stepId = this.generateSuspensionStepId(`event:${eventName}`);
		return this.run(stepId, async () => {
			const suspensionRequest: SuspensionRequest = {
				type: 'event',
				eventName,
				options,
			};
			this.onEvent?.({ type: 'suspended', stepId, request: suspensionRequest });
			throw new SuspensionError(stepId, suspensionRequest);
		});
	}

	/**
	 * Sleep for a duration (suspends execution).
	 */
	async sleep(ms: number): Promise<void> {
		const stepId = this.generateSuspensionStepId(`sleep:${ms}`);
		return this.run(stepId, async () => {
			const suspensionRequest: SuspensionRequest = {
				type: 'sleep',
				durationMs: ms,
				wakeAt: Date.now() + ms,
			};
			this.onEvent?.({ type: 'suspended', stepId, request: suspensionRequest });
			throw new SuspensionError(stepId, suspensionRequest);
		});
	}

	/**
	 * Generate a unique step ID for a suspension.
	 */
	private generateSuspensionStepId(prefix: string): string {
		const count = [...this.executedSteps].filter((s) => s.startsWith(`__suspension:${prefix}:`)).length;
		return `__suspension:${prefix}:${count}`;
	}

	/**
	 * Get the list of completed steps for checkpointing.
	 */
	getCompletedSteps(): CompletedStep[] {
		return [...this.completedSteps.values()].map((step) => ({ ...step }));
	}

	/**
	 * Check if a specific step has been completed.
	 */
	hasCompletedStep(stepId: string): boolean {
		return this.completedSteps.has(stepId);
	}

	/**
	 * Get the result of a completed step.
	 */
	getCompletedStepResult<T>(stepId: string): T | undefined {
		return this.completedSteps.get(stepId)?.result as T | undefined;
	}
}

/**
 * Create a step context with the given options.
 */
export function createStepContext(options?: StepContextOptions): StepContextImpl {
	return new StepContextImpl(options);
}
