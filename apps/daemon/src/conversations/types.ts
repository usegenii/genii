/**
 * Types for conversation management and bindings.
 */

import type { Destination } from '@genii/comms/destination/types';
import type { ChannelId } from '@genii/comms/types/core';
import type { AgentSessionId } from '@genii/orchestrator/types/core';

/**
 * Binding between a destination and an agent session.
 *
 * Tracks the mapping between a channel destination and the agent
 * currently handling conversations at that destination.
 */
export interface ConversationBinding {
	/** The destination (channel + ref) for routing messages */
	destination: Destination;
	/** The currently bound agent session ID, or null if no agent is bound */
	agentId: AgentSessionId | null;
	/** When the binding was created */
	createdAt: Date;
	/** When the binding was last active (updated on bind/message activity) */
	lastActivityAt: Date;
}

/**
 * Filter criteria for listing conversation bindings.
 */
export interface ConversationFilter {
	/** Filter by channel ID */
	channelId?: ChannelId;
	/** Filter by whether an agent is bound */
	hasAgent?: boolean;
}

/**
 * Serialized form of ConversationBinding for persistence.
 */
export interface SerializedConversationBinding {
	destination: Destination;
	agentId: string | null;
	createdAt: string;
	lastActivityAt: string;
}
