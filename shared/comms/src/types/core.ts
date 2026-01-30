/**
 * Core types for the communications system.
 */

/**
 * Branded type for channel instance IDs.
 */
export type ChannelId = string & { readonly __brand: 'ChannelId' };

/**
 * Create a ChannelId from a string.
 */
export function createChannelId(id: string): ChannelId {
	return id as ChannelId;
}

/**
 * Generate a new unique ChannelId.
 */
export function generateChannelId(): ChannelId {
	return crypto.randomUUID() as ChannelId;
}

/**
 * Function to dispose of a subscription or resource.
 */
export type Disposable = () => void;

/**
 * Status of a channel throughout its lifecycle.
 */
export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
