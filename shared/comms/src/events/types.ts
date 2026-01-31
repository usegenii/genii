/**
 * Event types for the communications system.
 */

import type { Author, InboundContent, OutboundContent, Reaction } from '../content/types';
import type { DestinationWithMetadata } from '../destination/types';
import type { ChannelId } from '../types/core';

// ============================================================================
// Inbound Events (from messaging platforms to gateway)
// ============================================================================

/**
 * Union of all inbound events from messaging platforms.
 */
export type InboundEvent =
	| MessageReceivedEvent
	| MessageEditedEvent
	| MessageDeletedEvent
	| ReactionAddedEvent
	| ReactionRemovedEvent
	| CommandReceivedEvent
	| CallbackReceivedEvent
	| ConversationStartedEvent
	| MemberJoinedEvent
	| MemberLeftEvent;

/**
 * New message received.
 */
export interface MessageReceivedEvent {
	type: 'message_received';
	origin: DestinationWithMetadata;
	author: Author;
	content: InboundContent;
	timestamp: number;
}

/**
 * Message was edited.
 */
export interface MessageEditedEvent {
	type: 'message_edited';
	origin: DestinationWithMetadata;
	author: Author;
	newContent: InboundContent;
	timestamp: number;
}

/**
 * Message was deleted.
 */
export interface MessageDeletedEvent {
	type: 'message_deleted';
	origin: DestinationWithMetadata;
	timestamp: number;
}

/**
 * Reaction was added to a message.
 */
export interface ReactionAddedEvent {
	type: 'reaction_added';
	origin: DestinationWithMetadata;
	author: Author;
	reaction: Reaction;
	timestamp: number;
}

/**
 * Reaction was removed from a message.
 */
export interface ReactionRemovedEvent {
	type: 'reaction_removed';
	origin: DestinationWithMetadata;
	author: Author;
	reaction: Reaction;
	timestamp: number;
}

/**
 * Bot command received (e.g., /start, /help).
 */
export interface CommandReceivedEvent {
	type: 'command_received';
	origin: DestinationWithMetadata;
	author: Author;
	command: string;
	args: string;
	timestamp: number;
}

/**
 * Callback button pressed (e.g., inline keyboard).
 * The callbackId is opaque and used only with AnswerCallbackIntent.
 */
export interface CallbackReceivedEvent {
	type: 'callback_received';
	origin: DestinationWithMetadata;
	author: Author;
	callbackId: string;
	data: string;
	timestamp: number;
}

/**
 * New conversation started (e.g., user started bot).
 */
export interface ConversationStartedEvent {
	type: 'conversation_started';
	origin: DestinationWithMetadata;
	author: Author;
	timestamp: number;
}

/**
 * Member joined a group/channel.
 */
export interface MemberJoinedEvent {
	type: 'member_joined';
	origin: DestinationWithMetadata;
	member: Author;
	timestamp: number;
}

/**
 * Member left a group/channel.
 */
export interface MemberLeftEvent {
	type: 'member_left';
	origin: DestinationWithMetadata;
	member: Author;
	timestamp: number;
}

// ============================================================================
// Outbound Intents (from agent to messaging platforms)
// ============================================================================

/**
 * Union of all outbound intents that agents can emit.
 * Channels interpret these based on platform capabilities.
 */
export type OutboundIntent =
	| AgentThinkingIntent
	| AgentStreamingIntent
	| AgentRespondingIntent
	| AgentToolCallIntent
	| AgentToolProgressIntent
	| AgentErrorIntent;

/**
 * Agent is thinking/processing.
 * Channel may show typing indicator or no-op.
 */
export interface AgentThinkingIntent {
	type: 'agent_thinking';
	destination: DestinationWithMetadata;
}

/**
 * Agent is streaming a response.
 * Channel may show typing/draft or no-op.
 */
export interface AgentStreamingIntent {
	type: 'agent_streaming';
	destination: DestinationWithMetadata;
	partial?: string;
}

/**
 * Agent has a response to send.
 * Channel sends the message.
 */
export interface AgentRespondingIntent {
	type: 'agent_responding';
	destination: DestinationWithMetadata;
	content: OutboundContent;
}

/**
 * Agent is calling a tool.
 * Channel may show action status or no-op.
 */
export interface AgentToolCallIntent {
	type: 'agent_tool_call';
	destination: DestinationWithMetadata;
	toolName: string;
	toolInput?: unknown;
}

/**
 * Agent tool execution is in progress.
 * Channel may show typing indicator or no-op.
 */
export interface AgentToolProgressIntent {
	type: 'agent_tool_progress';
	destination: DestinationWithMetadata;
	toolName: string;
	toolCallId: string;
	progress?: {
		percentage?: number;
		message?: string;
	};
}

/**
 * Agent encountered an error.
 * Channel sends styled error message.
 */
export interface AgentErrorIntent {
	type: 'agent_error';
	destination: DestinationWithMetadata;
	error: string;
	recoverable: boolean;
}

// ============================================================================
// Intent Processing Confirmation
// ============================================================================

/**
 * Confirmation that an intent was processed.
 */
export interface IntentProcessedConfirmation {
	intentType: OutboundIntent['type'];
	success: boolean;
	error?: string;
	timestamp: number;
}

// ============================================================================
// Channel Lifecycle Events
// ============================================================================

/**
 * Union of all channel lifecycle events.
 */
export type ChannelLifecycleEvent = ChannelConnectedEvent | ChannelDisconnectedEvent | ChannelErrorEvent;

/**
 * Channel connected to platform.
 */
export interface ChannelConnectedEvent {
	type: 'channel_connected';
	channelId: ChannelId;
	timestamp: number;
}

/**
 * Channel disconnected from platform.
 */
export interface ChannelDisconnectedEvent {
	type: 'channel_disconnected';
	channelId: ChannelId;
	reason?: string;
	timestamp: number;
}

/**
 * Channel encountered an error.
 */
export interface ChannelErrorEvent {
	type: 'channel_error';
	channelId: ChannelId;
	error: string;
	recoverable: boolean;
	timestamp: number;
}
