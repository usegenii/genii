/**
 * Suspension system for durable tool execution.
 */

import type { SuspensionRequest } from './types.js';

/**
 * Error thrown when a tool suspends execution.
 * This is caught by the adapter to handle suspension.
 */
export class SuspensionError extends Error {
	readonly isSuspension = true;

	constructor(
		public readonly stepId: string,
		public readonly request: SuspensionRequest,
	) {
		super(`Tool suspended: ${request.type}`);
		this.name = 'SuspensionError';
	}
}

/**
 * Check if an error is a SuspensionError.
 */
export function isSuspensionError(error: unknown): error is SuspensionError {
	return error instanceof Error && 'isSuspension' in error && error.isSuspension === true;
}

/**
 * Error thrown when a step has already been executed.
 * This should not happen in normal operation.
 */
export class DuplicateStepError extends Error {
	constructor(stepId: string) {
		super(`Step "${stepId}" has already been executed`);
		this.name = 'DuplicateStepError';
	}
}

/**
 * Error thrown when a suspension is cancelled.
 */
export class SuspensionCancelledError extends Error {
	constructor(stepId: string) {
		super(`Suspension cancelled for step "${stepId}"`);
		this.name = 'SuspensionCancelledError';
	}
}

/**
 * Error thrown when a suspension times out.
 */
export class SuspensionTimeoutError extends Error {
	constructor(
		stepId: string,
		public readonly timeoutMs: number,
	) {
		super(`Suspension timed out for step "${stepId}" after ${timeoutMs}ms`);
		this.name = 'SuspensionTimeoutError';
	}
}
