/**
 * Channel factory registry for creating channels from configuration.
 */

import type { Channel } from '@genii/comms/channel/types';
import type { Logger } from '@genii/comms/logging/types';
import type { SecretStore } from '@genii/config/secrets/types';
import type { ChannelConfig } from '@genii/config/types/channel';
import type { ChannelFactory } from './types';

/**
 * Registry for channel factories.
 *
 * Manages factories for different channel types and dispatches
 * channel creation to the appropriate factory.
 */
export class ChannelFactoryRegistry {
	private readonly factories = new Map<string, ChannelFactory>();

	/**
	 * Register a channel factory.
	 *
	 * @param factory - The factory to register
	 */
	register(factory: ChannelFactory): void {
		this.factories.set(factory.type, factory);
	}

	/**
	 * Create a channel using the appropriate factory.
	 *
	 * @param id - The channel ID
	 * @param config - The channel configuration
	 * @param secretStore - Secret store for credential resolution
	 * @param logger - Logger instance for channel logging
	 * @returns The created channel
	 * @throws If no factory is registered for the channel type
	 */
	async create(id: string, config: ChannelConfig, secretStore: SecretStore, logger: Logger): Promise<Channel> {
		const factory = this.factories.get(config.type);
		if (!factory) {
			throw new Error(`Unknown channel type: ${config.type}`);
		}
		return factory.create(id, config, secretStore, logger);
	}
}
