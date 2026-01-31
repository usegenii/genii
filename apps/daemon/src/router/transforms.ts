/**
 * Event and intent transformation utilities.
 *
 * This module provides functions for transforming:
 * - Inbound events (from channels) to agent inputs
 * - Agent outputs to outbound intents (for channels)
 * - Platform-specific content normalization
 */

import type { Destination } from '@geniigotchi/comms/destination/types';
import type { InboundEvent, OutboundIntent } from '@geniigotchi/comms/events/types';
import type { AgentEvent } from '@geniigotchi/orchestrator/events/types';

/**
 * Result of transforming an inbound event to agent input.
 */
export interface AgentInputResult {
	message: string;
	context?: Record<string, unknown>;
}

/**
 * Transform an inbound event into agent input.
 *
 * Extracts the message content and relevant context from
 * platform-specific event structures.
 *
 * @param event - The inbound event to transform
 * @returns Agent input suitable for sending to an agent, or null if the event shouldn't trigger an agent
 */
export function inboundEventToAgentInput(event: InboundEvent): AgentInputResult | null {
	switch (event.type) {
		case 'message_received': {
			// Extract text from content
			const text = extractTextFromContent(event.content);
			if (text === null) {
				return null;
			}
			return {
				message: text,
				context: {
					origin: event.origin,
					author: event.author,
					timestamp: event.timestamp,
					eventType: 'message',
				},
			};
		}

		case 'command_received': {
			// Format as "/command args" message
			const message = event.args ? `/${event.command} ${event.args}` : `/${event.command}`;
			return {
				message: message.trim(),
				context: {
					origin: event.origin,
					author: event.author,
					timestamp: event.timestamp,
					eventType: 'command',
					command: event.command,
					args: event.args,
				},
			};
		}

		case 'callback_received': {
			// Format callback data as the message
			return {
				message: event.data,
				context: {
					origin: event.origin,
					author: event.author,
					timestamp: event.timestamp,
					eventType: 'callback',
					callbackId: event.callbackId,
				},
			};
		}

		case 'conversation_started': {
			// Conversation started - could trigger a welcome message
			return {
				message: '/start',
				context: {
					origin: event.origin,
					author: event.author,
					timestamp: event.timestamp,
					eventType: 'conversation_started',
				},
			};
		}

		// Events that shouldn't trigger agent processing
		case 'message_edited':
		case 'message_deleted':
		case 'reaction_added':
		case 'reaction_removed':
		case 'member_joined':
		case 'member_left':
			return null;

		default: {
			// Exhaustive check - TypeScript will error if a case is missed
			const _exhaustive: never = event;
			return null;
		}
	}
}

/**
 * Extract text content from inbound content.
 *
 * @param content - The inbound content
 * @returns The text content, or null if no text is available
 */
function extractTextFromContent(
	content:
		| { type: 'text'; text: string }
		| { type: 'media'; caption?: string }
		| { type: 'location' }
		| { type: 'contact'; firstName: string; lastName?: string; phoneNumber: string }
		| { type: 'sticker'; emoji?: string }
		| { type: 'poll_vote' },
): string | null {
	switch (content.type) {
		case 'text':
			return content.text;
		case 'media':
			// Use caption if available for media content
			return content.caption ?? null;
		case 'contact':
			// Format contact as text
			return `Contact: ${content.firstName}${content.lastName ? ` ${content.lastName}` : ''} (${content.phoneNumber})`;
		case 'sticker':
			// Use emoji representation for stickers
			return content.emoji ?? null;
		case 'location':
		case 'poll_vote':
			// These don't have meaningful text content
			return null;
		default:
			return null;
	}
}

/**
 * Transform an agent event into an outbound intent.
 *
 * Converts agent output into platform-agnostic intent format
 * that channels can interpret.
 *
 * @param event - The agent event
 * @param destination - Where to send the response
 * @returns Outbound intent for the channel, or null if no intent should be sent
 */
export function agentEventToOutboundIntent(event: AgentEvent, destination: Destination): OutboundIntent | null {
	switch (event.type) {
		case 'status': {
			// For running status, indicate agent is thinking
			if (event.status === 'running') {
				return {
					type: 'agent_thinking',
					destination: {
						...destination,
						metadata: {
							conversationType: 'direct',
						},
					},
				};
			}
			// For waiting/other statuses, no intent needed
			return null;
		}

		case 'output': {
			if (event.final) {
				// Final output marker - only send if there's actual text
				// (The done event will contain the complete output)
				if (!event.text) {
					return null;
				}
				return {
					type: 'agent_responding',
					destination: {
						...destination,
						metadata: {
							conversationType: 'direct',
						},
					},
					content: {
						type: 'text',
						text: event.text,
					},
				};
			}
			// Streaming output - send as agent_streaming
			return {
				type: 'agent_streaming',
				destination: {
					...destination,
					metadata: {
						conversationType: 'direct',
					},
				},
				partial: event.text,
			};
		}

		case 'tool_start': {
			// Indicate tool call is happening
			return {
				type: 'agent_tool_call',
				destination: {
					...destination,
					metadata: {
						conversationType: 'direct',
					},
				},
				toolName: event.toolName,
				toolInput: event.input,
			};
		}

		case 'error': {
			// Send error intent
			return {
				type: 'agent_error',
				destination: {
					...destination,
					metadata: {
						conversationType: 'direct',
					},
				},
				error: event.error,
				recoverable: !event.fatal,
			};
		}

		case 'done': {
			// Send the final complete output if available
			if (event.result.output) {
				return {
					type: 'agent_responding',
					destination: {
						...destination,
						metadata: {
							conversationType: 'direct',
						},
					},
					content: {
						type: 'text',
						text: event.result.output,
					},
				};
			}
			return null;
		}

		case 'thought':
		case 'tool_end':
			// These events indicate active agent work - refresh typing indicator
			return {
				type: 'agent_thinking',
				destination: {
					...destination,
					metadata: {
						conversationType: 'direct',
					},
				},
			};

		case 'tool_progress':
			// Tool execution in progress - send dedicated progress intent
			return {
				type: 'agent_tool_progress',
				destination: {
					...destination,
					metadata: {
						conversationType: 'direct',
					},
				},
				toolName: event.toolName,
				toolCallId: event.toolCallId,
				progress: event.progress
					? {
							percentage: event.progress.percentage,
							message: event.progress.message,
						}
					: undefined,
			};

		// Events that don't need outbound intents
		case 'suspended':
		case 'memory_updated':
			return null;

		default: {
			// Exhaustive check
			const _exhaustive: never = event;
			return null;
		}
	}
}

/**
 * Normalize text content from platform-specific formats.
 *
 * Handles differences in markdown, mentions, and other
 * platform-specific formatting.
 *
 * @param text - The text to normalize
 * @param platform - The source platform
 * @returns Normalized text
 */
export function normalizeText(text: string, _platform: string): string {
	// TODO: Handle platform-specific formatting
	// - Telegram: @mentions, custom markdown
	// - Discord: <@userId> mentions, custom emoji
	// - Slack: <@userId> mentions, mrkdwn
	return text;
}
