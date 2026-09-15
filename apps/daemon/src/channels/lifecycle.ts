import type { Channel } from '@genii/comms/channel/types';

const channelOperationQueues = new WeakMap<Channel, Promise<void>>();

/**
 * Serialize lifecycle operations for a channel across daemon and RPC callers.
 */
export async function enqueueChannelOperation(channel: Channel, operation: () => Promise<void>): Promise<void> {
	const previous = channelOperationQueues.get(channel) ?? Promise.resolve();
	const current = previous.catch(() => undefined).then(operation);
	channelOperationQueues.set(channel, current);

	try {
		await current;
	} finally {
		if (channelOperationQueues.get(channel) === current) {
			channelOperationQueues.delete(channel);
		}
	}
}
