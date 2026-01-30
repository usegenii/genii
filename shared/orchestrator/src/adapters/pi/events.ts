/**
 * Pi event mapping.
 */

import type { AgentEvent as PiAgentEvent } from '@mariozechner/pi-agent-core';
import type { AgentEvent } from '../../events/types.js';

/**
 * Map a Pi agent event to our AgentEvent type.
 */
export function mapPiEvent(
	piEvent: PiAgentEvent,
	toolCallTimes: Map<string, number>,
): AgentEvent | AgentEvent[] | null {
	const timestamp = Date.now();

	switch (piEvent.type) {
		case 'agent_start':
			return {
				type: 'status',
				status: 'running',
				timestamp,
			};

		case 'agent_end':
			// This will be handled separately to include full result
			return null;

		case 'turn_start':
			// Internal event, not exposed
			return null;

		case 'turn_end':
			// Internal event, not exposed
			return null;

		case 'message_start':
			// Internal event, not exposed
			return null;

		case 'message_update': {
			const events: AgentEvent[] = [];
			const event = piEvent.assistantMessageEvent;

			if (event.type === 'text_delta') {
				events.push({
					type: 'output',
					text: event.delta,
					final: false,
					timestamp,
				});
			} else if (event.type === 'text_end') {
				events.push({
					type: 'output',
					text: '',
					final: true,
					timestamp,
				});
			} else if (event.type === 'thinking_delta') {
				events.push({
					type: 'thought',
					content: event.delta,
					timestamp,
				});
			}

			return events.length > 0 ? events : null;
		}

		case 'message_end':
			// Internal event, not exposed
			return null;

		case 'tool_execution_start':
			toolCallTimes.set(piEvent.toolCallId, Date.now());
			return {
				type: 'tool_start',
				toolCallId: piEvent.toolCallId,
				toolName: piEvent.toolName,
				input: piEvent.args,
				timestamp,
			};

		case 'tool_execution_update':
			return {
				type: 'tool_progress',
				toolCallId: piEvent.toolCallId,
				toolName: piEvent.toolName,
				progress: {
					message: 'In progress',
					data: { partialResult: piEvent.partialResult },
				},
				timestamp,
			};

		case 'tool_execution_end': {
			const startTime = toolCallTimes.get(piEvent.toolCallId) ?? timestamp;
			toolCallTimes.delete(piEvent.toolCallId);

			return {
				type: 'tool_end',
				toolCallId: piEvent.toolCallId,
				toolName: piEvent.toolName,
				output: piEvent.isError ? undefined : piEvent.result,
				error: piEvent.isError
					? typeof piEvent.result === 'string'
						? piEvent.result
						: JSON.stringify(piEvent.result)
					: undefined,
				durationMs: timestamp - startTime,
				timestamp,
			};
		}

		default:
			return null;
	}
}
