/**
 * Channel factory types for creating channels from configuration.
 */

import type { Channel } from '@genii/comms/channel/types';
import type { Logger } from '@genii/comms/logging/types';
import type { SecretStore } from '@genii/config/secrets/types';
import type { ChannelConfig } from '@genii/config/types/channel';

/**
 * Factory interface for creating channels from configuration.
 */
export interface ChannelFactory {
	/** The channel type this factory handles (e.g., 'telegram') */
	readonly type: string;

	/**
	 * Create a channel instance from configuration.
	 *
	 * @param id - The channel ID from configuration
	 * @param config - The channel configuration
	 * @param secretStore - Secret store for resolving credentials
	 * @param logger - Logger instance for channel logging
	 * @returns A configured channel instance
	 */
	create(id: string, config: ChannelConfig, secretStore: SecretStore, logger: Logger): Promise<Channel>;
}
