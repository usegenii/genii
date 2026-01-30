import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '../../channel/types';
import type { InboundEvent, IntentProcessedConfirmation, OutboundIntent } from '../../events/types';
import type { ChannelId, ChannelStatus, Disposable } from '../../types/core';
import { createChannelId } from '../../types/core';
import { ChannelRegistryImpl } from '../impl';

/**
 * Creates a mock channel for testing.
 */
function createMockChannel(id: ChannelId, adapter = 'mock'): Channel {
	const handlers = new Set<(event: InboundEvent) => void>();

	return {
		id,
		adapter,
		status: 'connected' as ChannelStatus,
		process: vi.fn().mockResolvedValue({
			intentType: 'agent_responding',
			success: true,
			timestamp: Date.now(),
		} satisfies IntentProcessedConfirmation),
		fetchMedia: vi.fn().mockResolvedValue(new ReadableStream()),
		subscribe: vi.fn((handler: (event: InboundEvent) => void): Disposable => {
			handlers.add(handler);
			return () => handlers.delete(handler);
		}),
		events: vi.fn().mockReturnValue({
			[Symbol.asyncIterator]: () => ({
				next: () => Promise.resolve({ done: true, value: undefined }),
			}),
		}),
		onLifecycle: vi.fn().mockReturnValue(() => {}),
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		// Helper to emit events for testing
		_emit: (event: InboundEvent) => {
			for (const handler of handlers) {
				handler(event);
			}
		},
	} as Channel & { _emit: (event: InboundEvent) => void };
}

/**
 * Creates a mock inbound event for testing.
 */
function createMockEvent(type: InboundEvent['type'] = 'message_received'): InboundEvent {
	const channelId = createChannelId('test-channel');
	return {
		type,
		origin: {
			channelId,
			ref: 'test-ref-123',
			metadata: {
				conversationType: 'direct',
				title: 'Test Conversation',
			},
		},
		author: {
			id: 'user-123',
			username: 'testuser',
			isBot: false,
		},
		content: {
			type: 'text',
			text: 'Hello, world!',
		},
		timestamp: Date.now(),
	} as InboundEvent;
}

/**
 * Creates a mock outbound intent for testing.
 */
function createMockIntent(): OutboundIntent {
	const channelId = createChannelId('test-channel');
	return {
		type: 'agent_responding',
		destination: {
			channelId,
			ref: 'test-ref-123',
			metadata: {
				conversationType: 'direct',
				title: 'Test Conversation',
			},
		},
		content: {
			type: 'text',
			text: 'Hello from agent!',
		},
	} as OutboundIntent;
}

describe('ChannelRegistryImpl', () => {
	describe('register()', () => {
		it('should register a channel', () => {
			const registry = new ChannelRegistryImpl();
			const channel = createMockChannel(createChannelId('channel-1'));

			registry.register(channel);

			expect(registry.get(channel.id)).toBe(channel);
		});

		it('should throw on duplicate registration', () => {
			const registry = new ChannelRegistryImpl();
			const channelId = createChannelId('channel-1');
			const channel1 = createMockChannel(channelId);
			const channel2 = createMockChannel(channelId);

			registry.register(channel1);

			expect(() => registry.register(channel2)).toThrow('Channel with ID "channel-1" is already registered');
		});
	});

	describe('unregister()', () => {
		it('should unregister a channel', () => {
			const registry = new ChannelRegistryImpl();
			const channel = createMockChannel(createChannelId('channel-1'));

			registry.register(channel);
			expect(registry.get(channel.id)).toBe(channel);

			registry.unregister(channel.id);
			expect(registry.get(channel.id)).toBeUndefined();
		});

		it('should clean up subscription when unregistering', () => {
			const registry = new ChannelRegistryImpl();
			const channel = createMockChannel(createChannelId('channel-1')) as Channel & {
				_emit: (event: InboundEvent) => void;
			};

			registry.register(channel);

			const handler = vi.fn();
			registry.subscribe(handler);

			// Emit event before unregister - should be received
			channel._emit(createMockEvent());
			expect(handler).toHaveBeenCalledTimes(1);

			registry.unregister(channel.id);

			// Emit event after unregister - should not be received
			channel._emit(createMockEvent());
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe('get()', () => {
		it('should return registered channel', () => {
			const registry = new ChannelRegistryImpl();
			const channel = createMockChannel(createChannelId('channel-1'));

			registry.register(channel);

			const result = registry.get(channel.id);
			expect(result).toBe(channel);
		});

		it('should return undefined for unknown channel', () => {
			const registry = new ChannelRegistryImpl();
			const unknownId = createChannelId('unknown-channel');

			const result = registry.get(unknownId);
			expect(result).toBeUndefined();
		});
	});

	describe('list()', () => {
		it('should return all registered channels', () => {
			const registry = new ChannelRegistryImpl();
			const channel1 = createMockChannel(createChannelId('channel-1'));
			const channel2 = createMockChannel(createChannelId('channel-2'));
			const channel3 = createMockChannel(createChannelId('channel-3'));

			registry.register(channel1);
			registry.register(channel2);
			registry.register(channel3);

			const channels = registry.list();
			expect(channels).toHaveLength(3);
			expect(channels).toContain(channel1);
			expect(channels).toContain(channel2);
			expect(channels).toContain(channel3);
		});

		it('should return empty array when no channels registered', () => {
			const registry = new ChannelRegistryImpl();

			const channels = registry.list();
			expect(channels).toEqual([]);
		});
	});

	describe('subscribe()', () => {
		it('should receive events from all registered channels', () => {
			const registry = new ChannelRegistryImpl();
			const channel1 = createMockChannel(createChannelId('channel-1')) as Channel & {
				_emit: (event: InboundEvent) => void;
			};
			const channel2 = createMockChannel(createChannelId('channel-2')) as Channel & {
				_emit: (event: InboundEvent) => void;
			};

			registry.register(channel1);
			registry.register(channel2);

			const handler = vi.fn();
			registry.subscribe(handler);

			const event1 = createMockEvent();
			const event2 = createMockEvent('command_received');

			channel1._emit(event1);
			channel2._emit(event2);

			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenNthCalledWith(1, event1, channel1.id);
			expect(handler).toHaveBeenNthCalledWith(2, event2, channel2.id);
		});

		it('should return disposable to unsubscribe', () => {
			const registry = new ChannelRegistryImpl();
			const channel = createMockChannel(createChannelId('channel-1')) as Channel & {
				_emit: (event: InboundEvent) => void;
			};

			registry.register(channel);

			const handler = vi.fn();
			const dispose = registry.subscribe(handler);

			channel._emit(createMockEvent());
			expect(handler).toHaveBeenCalledTimes(1);

			dispose();

			channel._emit(createMockEvent());
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe('events()', () => {
		it('should yield events from channels via async iterator', async () => {
			const registry = new ChannelRegistryImpl();
			const channel = createMockChannel(createChannelId('channel-1')) as Channel & {
				_emit: (event: InboundEvent) => void;
			};

			registry.register(channel);

			const event = createMockEvent();
			const receivedEvents: Array<{ event: InboundEvent; channelId: ChannelId }> = [];

			// Start iterating in a separate promise
			const iteratorPromise = (async () => {
				for await (const channelEvent of registry.events()) {
					receivedEvents.push(channelEvent);
					if (receivedEvents.length >= 1) {
						break;
					}
				}
			})();

			// Give the iterator time to start
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Emit an event
			channel._emit(event);

			// Wait for the iterator to receive the event
			await iteratorPromise;

			expect(receivedEvents).toHaveLength(1);
			const firstEvent = receivedEvents[0];
			expect(firstEvent).toBeDefined();
			expect(firstEvent?.event).toBe(event);
			expect(firstEvent?.channelId).toBe(channel.id);
		});
	});

	describe('process()', () => {
		it('should route intent to correct channel', async () => {
			const registry = new ChannelRegistryImpl();
			const channel = createMockChannel(createChannelId('channel-1'));

			registry.register(channel);

			const intent = createMockIntent();
			const result = await registry.process(channel.id, intent);

			expect(channel.process).toHaveBeenCalledWith(intent);
			expect(result.success).toBe(true);
			expect(result.intentType).toBe('agent_responding');
		});

		it('should throw for unknown channel', async () => {
			const registry = new ChannelRegistryImpl();
			const unknownId = createChannelId('unknown-channel');
			const intent = createMockIntent();

			await expect(registry.process(unknownId, intent)).rejects.toThrow(
				'Channel with ID "unknown-channel" not found',
			);
		});
	});
});
