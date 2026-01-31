/**
 * Channel and adapter interface types.
 */

import type { ChannelLifecycleEvent, InboundEvent, IntentProcessedConfirmation, OutboundIntent } from '../events/types';
import type { ChannelId, ChannelStatus, Disposable } from '../types/core';

/**
 * A channel represents a connection to a messaging platform.
 */
export interface Channel {
	/** Unique channel instance ID */
	readonly id: ChannelId;

	/** Name of adapter that created this channel */
	readonly adapter: string;

	/** Current connection status */
	readonly status: ChannelStatus;

	/**
	 * Process a semantic intent.
	 * The channel interprets the intent based on platform capabilities.
	 */
	process(intent: OutboundIntent): Promise<IntentProcessedConfirmation>;

	/**
	 * Fetch media by opaque reference.
	 * The reference is platform-specific (e.g., Telegram file_id).
	 */
	fetchMedia(ref: string): Promise<ReadableStream<Uint8Array>>;

	/**
	 * Subscribe to inbound events.
	 * @returns Disposable to unsubscribe
	 */
	subscribe(handler: (event: InboundEvent) => void): Disposable;

	/**
	 * Async iterator for inbound events.
	 */
	events(): AsyncIterable<InboundEvent>;

	/**
	 * Subscribe to lifecycle events.
	 * @returns Disposable to unsubscribe
	 */
	onLifecycle(handler: (event: ChannelLifecycleEvent) => void): Disposable;

	/**
	 * Connect to the messaging platform.
	 */
	connect(): Promise<void>;

	/**
	 * Disconnect from the messaging platform.
	 */
	disconnect(): Promise<void>;

	/**
	 * Register slash commands with the platform.
	 * Not all platforms support this (optional method).
	 *
	 * @param commands - Array of command definitions to register
	 */
	setCommands?(commands: Array<{ name: string; description: string }>): Promise<void>;
}

/**
 * Base configuration for creating a channel.
 */
export interface ChannelConfig {
	/** Optional ID for the channel. If not provided, one will be generated. */
	id?: ChannelId;
}

/**
 * Adapter for creating channel instances.
 */
export interface ChannelAdapter<TConfig extends ChannelConfig = ChannelConfig> {
	/** Name of this adapter */
	readonly name: string;

	/**
	 * Create a new channel instance.
	 */
	create(config: TConfig): Channel;
}
