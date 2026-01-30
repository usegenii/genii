/**
 * Channel registry implementation.
 */

import type { Channel } from '../channel/types';
import { TypedEventEmitter } from '../events/emitter';
import type { InboundEvent, IntentProcessedConfirmation, OutboundIntent } from '../events/types';
import type { ChannelId, Disposable } from '../types/core';
import type { ChannelEvent, ChannelRegistry } from './types';

/**
 * Implementation of the channel registry.
 * Manages multiple channels and provides aggregated event handling.
 */
export class ChannelRegistryImpl implements ChannelRegistry {
	private channels = new Map<ChannelId, Channel>();
	private subscriptions = new Map<ChannelId, Disposable>();
	private emitter = new TypedEventEmitter<ChannelEvent>();

	/**
	 * Register a channel with the registry.
	 *
	 * @param channel - Channel to register
	 * @throws If a channel with the same ID is already registered
	 */
	register(channel: Channel): void {
		if (this.channels.has(channel.id)) {
			throw new Error(`Channel with ID "${channel.id}" is already registered`);
		}

		this.channels.set(channel.id, channel);

		// Subscribe to the channel's events and forward them with the channel ID
		const dispose = channel.subscribe((event: InboundEvent) => {
			this.emitter.emit({ event, channelId: channel.id });
		});

		this.subscriptions.set(channel.id, dispose);
	}

	/**
	 * Unregister a channel from the registry.
	 *
	 * @param channelId - ID of the channel to unregister
	 */
	unregister(channelId: ChannelId): void {
		// Clean up the subscription first
		const dispose = this.subscriptions.get(channelId);
		if (dispose) {
			dispose();
			this.subscriptions.delete(channelId);
		}

		this.channels.delete(channelId);
	}

	/**
	 * Get a channel by ID.
	 *
	 * @param channelId - ID of the channel to retrieve
	 * @returns The channel, or undefined if not found
	 */
	get(channelId: ChannelId): Channel | undefined {
		return this.channels.get(channelId);
	}

	/**
	 * List all registered channels.
	 *
	 * @returns Array of all registered channels
	 */
	list(): Channel[] {
		return Array.from(this.channels.values());
	}

	/**
	 * Subscribe to aggregated inbound events from all channels.
	 *
	 * @param handler - Function to call when an event is received
	 * @returns Disposable to unsubscribe
	 */
	subscribe(handler: (event: InboundEvent, channelId: ChannelId) => void): Disposable {
		return this.emitter.on(({ event, channelId }) => {
			handler(event, channelId);
		});
	}

	/**
	 * Async iterable of aggregated events from all channels.
	 *
	 * @returns Async iterable that yields events with their channel IDs
	 */
	async *events(): AsyncIterable<ChannelEvent> {
		yield* this.emitter;
	}

	/**
	 * Route an intent to a specific channel for processing.
	 *
	 * @param channelId - ID of the channel to route the intent to
	 * @param intent - The outbound intent to process
	 * @returns Confirmation of the intent processing
	 * @throws If the channel is not found
	 */
	async process(channelId: ChannelId, intent: OutboundIntent): Promise<IntentProcessedConfirmation> {
		const channel = this.channels.get(channelId);
		if (!channel) {
			throw new Error(`Channel with ID "${channelId}" not found`);
		}

		return channel.process(intent);
	}
}
