/**
 * Channel initialization for the daemon.
 *
 * Loads channel configuration and creates channel instances.
 */

import { ChannelRegistryImpl } from '@geniigotchi/comms/registry/impl';
import type { ChannelRegistry } from '@geniigotchi/comms/registry/types';
import type { Config } from '@geniigotchi/config/config';
import type { SecretStore } from '@geniigotchi/config/secrets/types';
import type { Logger } from '../logging/logger';
import { ChannelFactoryRegistry } from './factory';
import { TelegramChannelFactory } from './telegram';

/**
 * Initialize all channels from configuration.
 *
 * @param config - The loaded configuration
 * @param secretStore - Secret store for credential resolution
 * @param logger - Logger instance
 * @returns A channel registry with all configured channels
 */
export async function initializeChannels(
	config: Config,
	secretStore: SecretStore,
	logger: Logger,
): Promise<ChannelRegistry> {
	const channels = config.getChannels();

	if (Object.keys(channels).length === 0) {
		logger.warn('No channels configured in channels.toml');
	}

	// Create and configure the factory registry
	const factoryRegistry = new ChannelFactoryRegistry();
	factoryRegistry.register(new TelegramChannelFactory());

	// Create the channel registry
	const channelRegistry = new ChannelRegistryImpl();

	// Create and register each configured channel
	for (const [id, channelConfig] of Object.entries(channels)) {
		try {
			const channelLogger = logger.child({ channelId: id });
			const channel = await factoryRegistry.create(id, channelConfig, secretStore, channelLogger);
			channelRegistry.register(channel);
			logger.info({ channelId: id, type: channelConfig.type }, 'Channel registered');
		} catch (error) {
			logger.error({ channelId: id, error }, 'Failed to create channel');
		}
	}

	return channelRegistry;
}
