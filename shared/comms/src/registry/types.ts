/**
 * Channel registry interface types.
 */

import type { Channel } from '../channel/types';
import type { InboundEvent, IntentProcessedConfirmation, OutboundIntent } from '../events/types';
import type { ChannelId, Disposable } from '../types/core';

/**
 * Event with channel ID for aggregated events from the registry.
 */
export interface ChannelEvent {
	event: InboundEvent;
	channelId: ChannelId;
}

/**
 * Registry for managing multiple channels.
 * Provides aggregated event handling and intent routing.
 */
export interface ChannelRegistry {
	/**
	 * Register a channel with the registry.
	 *
	 * @param channel - Channel to register
	 * @throws If a channel with the same ID is already registered
	 */
	register(channel: Channel): void;

	/**
	 * Unregister a channel from the registry.
	 *
	 * @param channelId - ID of the channel to unregister
	 */
	unregister(channelId: ChannelId): void;

	/**
	 * Get a channel by ID.
	 *
	 * @param channelId - ID of the channel to retrieve
	 * @returns The channel, or undefined if not found
	 */
	get(channelId: ChannelId): Channel | undefined;

	/**
	 * List all registered channels.
	 *
	 * @returns Array of all registered channels
	 */
	list(): Channel[];

	/**
	 * Subscribe to aggregated inbound events from all channels.
	 *
	 * @param handler - Function to call when an event is received
	 * @returns Disposable to unsubscribe
	 */
	subscribe(handler: (event: InboundEvent, channelId: ChannelId) => void): Disposable;

	/**
	 * Async iterable of aggregated events from all channels.
	 *
	 * @returns Async iterable that yields events with their channel IDs
	 */
	events(): AsyncIterable<ChannelEvent>;

	/**
	 * Route an intent to a specific channel for processing.
	 *
	 * @param channelId - ID of the channel to route the intent to
	 * @param intent - The outbound intent to process
	 * @returns Confirmation of the intent processing
	 * @throws If the channel is not found
	 */
	process(channelId: ChannelId, intent: OutboundIntent): Promise<IntentProcessedConfirmation>;
}
