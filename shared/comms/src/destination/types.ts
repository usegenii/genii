import type { ChannelId } from '../types/core';

/**
 * Simple destination structure for routing messages.
 */
export interface Destination {
	/** Routes to the correct channel */
	channelId: ChannelId;
	/** Opaque reference only the adapter understands (encodes chat ID, thread ID, reply-to, etc.) */
	ref: string;
}

/**
 * Context for agents about the conversation.
 */
export interface ConversationMetadata {
	/** Human-readable title if available */
	title?: string;
	/** Type of conversation */
	conversationType: 'direct' | 'group' | 'channel' | 'thread' | 'topic';
	/** Number of participants in the conversation */
	participantCount?: number;
	/** Platform-specific extras */
	platformData?: Record<string, unknown>;
}

/**
 * Destination with metadata, returned with inbound events.
 */
export interface DestinationWithMetadata extends Destination {
	metadata: ConversationMetadata;
}
