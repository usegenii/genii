import type { SuspensionId } from '@genii/orchestrator/tools/types';
import type { AgentSessionId } from '@genii/orchestrator/types/core';
import { describe, expect, it } from 'vitest';
import { AgentEventJournal } from './event-journal';

describe('AgentEventJournal', () => {
	it('normalizes arbitrary tool values into JSON-safe replay records', () => {
		const journal = new AgentEventJournal(10);
		const input: Record<string, unknown> = {
			bigint: 42n,
			invalidNumber: Number.POSITIVE_INFINITY,
			date: new Date('2026-01-02T03:04:05.000Z'),
		};
		input.circular = input;

		const record = journal.append('agent-json' as AgentSessionId, {
			type: 'tool_start',
			toolCallId: 'tool-1',
			toolName: 'unsafe-tool',
			input,
			timestamp: 1,
		});

		expect(record.event).toMatchObject({
			type: 'tool_start',
			input: {
				bigint: '42',
				invalidNumber: null,
				date: '2026-01-02T03:04:05.000Z',
				circular: '[Circular]',
			},
		});
		expect(() => JSON.stringify(record)).not.toThrow();
	});

	it('retains exact durable suspension identity and lifecycle fields', () => {
		const journal = new AgentEventJournal(10);

		const record = journal.append('agent-suspended' as AgentSessionId, {
			type: 'suspended',
			pendingRequests: [
				{
					suspensionId: 'call-1:step-2' as SuspensionId,
					toolCallId: 'call-1',
					toolName: 'wait_for_input',
					stepId: 'step-2',
					type: 'user_input',
					request: {
						type: 'user_input',
						prompt: 'Choose a value',
						schema: { default: 42n },
					},
					suspendedAt: 100,
					deadline: 200,
					status: 'waiting',
				},
			],
			timestamp: 101,
		});

		expect(record.event).toEqual({
			type: 'suspended',
			pendingRequests: [
				{
					suspensionId: 'call-1:step-2',
					toolCallId: 'call-1',
					toolName: 'wait_for_input',
					stepId: 'step-2',
					type: 'user_input',
					request: {
						type: 'user_input',
						prompt: 'Choose a value',
						schema: { default: '42' },
					},
					suspendedAt: 100,
					deadline: 200,
					status: 'waiting',
				},
			],
			timestamp: 101,
		});
		expect(() => JSON.stringify(record)).not.toThrow();
	});
});
