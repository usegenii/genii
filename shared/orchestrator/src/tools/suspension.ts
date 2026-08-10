/**
 * Suspension system for durable tool execution.
 */

import { isDeepStrictEqual } from 'node:util';
import type { StepResumeData, SuspensionId, SuspensionRequest, SuspensionResolution } from './types';

const RESOLUTION_BASE_FIELDS = ['suspensionId', 'type'] as const;

function hasOwn(value: Record<string, unknown>, property: string): boolean {
	return Object.hasOwn(value, property);
}

function assertAllowedFields(
	resolution: Record<string, unknown>,
	type: string,
	variantFields: readonly string[],
): void {
	const allowedFields = new Set<string>([...RESOLUTION_BASE_FIELDS, ...variantFields]);
	for (const field of Object.keys(resolution)) {
		if (!allowedFields.has(field)) {
			throw new Error(`Invalid ${type} resolution: unexpected field "${field}"`);
		}
	}
}

function assertOptionalString(resolution: Record<string, unknown>, type: string, field: string): void {
	if (hasOwn(resolution, field) && resolution[field] !== undefined && typeof resolution[field] !== 'string') {
		throw new Error(`Invalid ${type} resolution: "${field}" must be a string when provided`);
	}
}

/** Assert that an untrusted value is one exact durable resolution variant. */
export function assertSuspensionResolution(resolution: unknown): asserts resolution is SuspensionResolution {
	if (typeof resolution !== 'object' || resolution === null || Array.isArray(resolution)) {
		throw new Error('Invalid suspension resolution: expected an object');
	}

	const candidate = resolution as Record<string, unknown>;
	if (!hasOwn(candidate, 'suspensionId') || typeof candidate.suspensionId !== 'string' || !candidate.suspensionId) {
		throw new Error('Invalid suspension resolution: "suspensionId" must be a non-empty string');
	}
	if (!hasOwn(candidate, 'type') || typeof candidate.type !== 'string') {
		throw new Error('Invalid suspension resolution: "type" must be a string');
	}

	switch (candidate.type) {
		case 'user_input':
			assertAllowedFields(candidate, candidate.type, ['value']);
			if (!hasOwn(candidate, 'value') || candidate.value === undefined) {
				throw new Error('Invalid user_input resolution: missing required "value"');
			}
			return;
		case 'approval':
			assertAllowedFields(candidate, candidate.type, ['approved', 'reason']);
			if (!hasOwn(candidate, 'approved') || typeof candidate.approved !== 'boolean') {
				throw new Error('Invalid approval resolution: "approved" must be a boolean');
			}
			assertOptionalString(candidate, candidate.type, 'reason');
			return;
		case 'event':
			assertAllowedFields(candidate, candidate.type, ['payload']);
			if (!hasOwn(candidate, 'payload') || candidate.payload === undefined) {
				throw new Error('Invalid event resolution: missing required "payload"');
			}
			return;
		case 'sleep':
			assertAllowedFields(candidate, candidate.type, []);
			return;
		case 'cancel':
			assertAllowedFields(candidate, candidate.type, ['reason']);
			assertOptionalString(candidate, candidate.type, 'reason');
			return;
		case 'timeout':
			assertAllowedFields(candidate, candidate.type, []);
			return;
		default:
			throw new Error(`Invalid suspension resolution: unsupported type "${candidate.type}"`);
	}
}

/** Build the stable opaque identity for an exact suspended step. */
export function createSuspensionId(toolCallId: string, stepId: string): SuspensionId {
	return `${encodeURIComponent(toolCallId)}:${encodeURIComponent(stepId)}` as SuspensionId;
}

/** Return an absolute deadline for a request, if it has one. */
export function getSuspensionDeadline(request: SuspensionRequest, suspendedAt: number): number | undefined {
	if (request.type === 'sleep') {
		return request.wakeAt;
	}
	const timeout = request.type === 'event' ? request.options?.timeout : request.request.timeout;
	return timeout === undefined ? undefined : suspendedAt + timeout;
}

/** Compare resolution retries structurally, including false and null values. */
export function isIdenticalResolution(left: SuspensionResolution, right: SuspensionResolution): boolean {
	// Compare the JSON representation because checkpoints use JSON storage.
	// This intentionally treats an omitted optional property and one explicitly
	// set to undefined as the same retry after a restart.
	return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
}

/** Validate and normalize an accepted resolution for durable replay. */
export function normalizeSuspensionResolution(
	stepId: string,
	request: SuspensionRequest,
	resolution: SuspensionResolution,
): StepResumeData {
	assertSuspensionResolution(resolution);
	if (resolution.type !== 'cancel' && resolution.type !== 'timeout' && resolution.type !== request.type) {
		throw new Error(`Resolution type "${resolution.type}" does not match suspension type "${request.type}"`);
	}

	switch (resolution.type) {
		case 'user_input':
			return { stepId, outcome: { type: 'value', value: resolution.value } };
		case 'approval':
			return {
				stepId,
				outcome: {
					type: 'value',
					value: { approved: resolution.approved, reason: resolution.reason },
				},
			};
		case 'event':
			return { stepId, outcome: { type: 'value', value: resolution.payload } };
		case 'sleep':
			return { stepId, outcome: { type: 'void' } };
		case 'cancel':
			return { stepId, outcome: { type: 'cancelled', reason: resolution.reason } };
		case 'timeout':
			return { stepId, outcome: { type: 'timeout' } };
	}
}

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
	constructor(
		stepId: string,
		public readonly reason?: string,
	) {
		super(`Suspension cancelled for step "${stepId}"${reason ? `: ${reason}` : ''}`);
		this.name = 'SuspensionCancelledError';
	}
}

/**
 * Error thrown when a suspension times out.
 */
export class SuspensionTimeoutError extends Error {
	constructor(stepId: string) {
		super(`Suspension timed out for step "${stepId}"`);
		this.name = 'SuspensionTimeoutError';
	}
}
