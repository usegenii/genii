/**
 * Mock adapter factory for testing.
 */

import type { Channel, ChannelAdapter } from '../../channel/types';
import type { MockChannelConfig } from './channel';
import { MockChannel } from './channel';

/**
 * Adapter for creating mock channel instances.
 */
export class MockAdapter implements ChannelAdapter<MockChannelConfig> {
	readonly name = 'mock';

	/**
	 * Create a new mock channel instance.
	 */
	create(config: MockChannelConfig = {}): Channel {
		return new MockChannel(config);
	}
}

/**
 * Create a MockAdapter instance.
 */
export function createMockAdapter(): MockAdapter {
	return new MockAdapter();
}
