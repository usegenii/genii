import { describe, expect, it } from 'vitest';
import {
	assertSuspensionResolution,
	createSuspensionId,
	getSuspensionDeadline,
	isIdenticalResolution,
	normalizeSuspensionResolution,
} from '../suspension';
import type { SuspensionRequest, SuspensionResolution } from '../types';

describe('durable suspension contracts', () => {
	it('creates a stable ID from the exact tool call and step IDs', () => {
		expect(createSuspensionId('tool:1', '__suspension:event:build:0')).toBe(
			createSuspensionId('tool:1', '__suspension:event:build:0'),
		);
		expect(createSuspensionId('tool:1', '__suspension:event:build:0')).not.toBe(
			createSuspensionId('tool:1', '__suspension:event:build:1'),
		);
	});

	it.each([
		[{ type: 'user_input', request: { prompt: 'value', timeout: 25 } }, 1025],
		[{ type: 'approval', request: { action: 'ship', timeout: 50 } }, 1050],
		[{ type: 'event', eventName: 'build', options: { timeout: 75 } }, 1075],
		[{ type: 'sleep', durationMs: 100, wakeAt: 1100 }, 1100],
	] satisfies Array<[SuspensionRequest, number]>)('computes the absolute deadline for %s', (request, deadline) => {
		expect(getSuspensionDeadline(request, 1000)).toBe(deadline);
	});

	it('normalizes approval rejection, false, null, and void without truthiness fallbacks', () => {
		const id = createSuspensionId('call', 'step');

		expect(
			normalizeSuspensionResolution(
				'step',
				{ type: 'user_input', request: { prompt: 'value' } },
				{
					suspensionId: id,
					type: 'user_input',
					value: false,
				},
			),
		).toEqual({ stepId: 'step', outcome: { type: 'value', value: false } });
		expect(
			normalizeSuspensionResolution(
				'step',
				{ type: 'approval', request: { action: 'ship' } },
				{
					suspensionId: id,
					type: 'approval',
					approved: false,
					reason: 'not yet',
				},
			),
		).toEqual({
			stepId: 'step',
			outcome: { type: 'value', value: { approved: false, reason: 'not yet' } },
		});
		expect(
			normalizeSuspensionResolution(
				'step',
				{ type: 'event', eventName: 'done' },
				{
					suspensionId: id,
					type: 'event',
					payload: null,
				},
			),
		).toEqual({ stepId: 'step', outcome: { type: 'value', value: null } });
		expect(
			normalizeSuspensionResolution(
				'step',
				{ type: 'sleep', durationMs: 1, wakeAt: 2 },
				{
					suspensionId: id,
					type: 'sleep',
				},
			),
		).toEqual({ stepId: 'step', outcome: { type: 'void' } });
		expect(
			normalizeSuspensionResolution(
				'step',
				{ type: 'event', eventName: 'done' },
				{
					suspensionId: id,
					type: 'cancel',
					reason: 'operator request',
				},
			),
		).toEqual({ stepId: 'step', outcome: { type: 'cancelled', reason: 'operator request' } });
		expect(
			normalizeSuspensionResolution(
				'step',
				{ type: 'event', eventName: 'done' },
				{
					suspensionId: id,
					type: 'timeout',
				},
			),
		).toEqual({ stepId: 'step', outcome: { type: 'timeout' } });
	});

	it.each([
		['non-object value', null, 'expected an object'],
		['array value', [], 'expected an object'],
		['missing suspension ID', { type: 'sleep' }, '"suspensionId" must be a non-empty string'],
		['empty suspension ID', { suspensionId: '', type: 'sleep' }, '"suspensionId" must be a non-empty string'],
		['non-string suspension ID', { suspensionId: 1, type: 'sleep' }, '"suspensionId" must be a non-empty string'],
		['missing type', { suspensionId: 'id' }, '"type" must be a string'],
		['unsupported type', { suspensionId: 'id', type: 'other' }, 'unsupported type "other"'],
		['user input without a value', { suspensionId: 'id', type: 'user_input' }, 'missing required "value"'],
		[
			'user input with an undefined value',
			{ suspensionId: 'id', type: 'user_input', value: undefined },
			'missing required "value"',
		],
		[
			'user input with an extra field',
			{ suspensionId: 'id', type: 'user_input', value: null, approved: true },
			'unexpected field "approved"',
		],
		['approval without a decision', { suspensionId: 'id', type: 'approval' }, '"approved" must be a boolean'],
		[
			'approval with a string decision',
			{ suspensionId: 'id', type: 'approval', approved: 'yes' },
			'"approved" must be a boolean',
		],
		[
			'approval with a non-string reason',
			{ suspensionId: 'id', type: 'approval', approved: false, reason: 123 },
			'"reason" must be a string when provided',
		],
		['event without a payload', { suspensionId: 'id', type: 'event' }, 'missing required "payload"'],
		[
			'event with an undefined payload',
			{ suspensionId: 'id', type: 'event', payload: undefined },
			'missing required "payload"',
		],
		[
			'sleep with an extra field',
			{ suspensionId: 'id', type: 'sleep', reason: 'done' },
			'unexpected field "reason"',
		],
		[
			'cancellation with a non-string reason',
			{ suspensionId: 'id', type: 'cancel', reason: false },
			'"reason" must be a string when provided',
		],
		[
			'timeout with an extra field',
			{ suspensionId: 'id', type: 'timeout', reason: 'late' },
			'unexpected field "reason"',
		],
	] as const)('rejects malformed %s', (_label, resolution, message) => {
		expect(() => assertSuspensionResolution(resolution)).toThrow(message);
	});

	it('validates the runtime shape before normalizing a typed resolution', () => {
		const malformed = {
			suspensionId: createSuspensionId('call', 'step'),
			type: 'approval',
			approved: 'yes',
		} as unknown as SuspensionResolution;

		expect(() =>
			normalizeSuspensionResolution('step', { type: 'approval', request: { action: 'ship' } }, malformed),
		).toThrow('"approved" must be a boolean');
	});

	it('rejects a wrongly typed resolution', () => {
		const suspensionId = createSuspensionId('call', 'step');
		expect(() =>
			normalizeSuspensionResolution(
				'step',
				{ type: 'approval', request: { action: 'ship' } },
				{
					suspensionId,
					type: 'event',
					payload: false,
				},
			),
		).toThrow('does not match suspension type');
	});

	it('recognizes identical retries and rejects conflicting values', () => {
		const suspensionId = createSuspensionId('call', 'step');
		const first: SuspensionResolution = { suspensionId, type: 'event', payload: { ok: false } };
		const duplicate: SuspensionResolution = { suspensionId, type: 'event', payload: { ok: false } };
		const conflict: SuspensionResolution = { suspensionId, type: 'event', payload: { ok: true } };

		expect(isIdenticalResolution(first, duplicate)).toBe(true);
		expect(isIdenticalResolution(first, conflict)).toBe(false);
	});

	it('compares retries using their persisted JSON representation', () => {
		const suspensionId = createSuspensionId('call', 'step');
		expect(
			isIdenticalResolution(
				{ suspensionId, type: 'approval', approved: false, reason: undefined },
				{ suspensionId, type: 'approval', approved: false },
			),
		).toBe(true);
	});
});
