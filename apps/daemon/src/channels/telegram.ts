/**
 * Telegram channel factory for creating Telegram channels from configuration.
 */

import { TelegramChannel } from '@genii/comms/adapters/telegram/channel';
import type { Channel } from '@genii/comms/channel/types';
import { UserAllowlistFilter } from '@genii/comms/filters/user';
import type { Logger } from '@genii/comms/logging/types';
import type { ChannelId } from '@genii/comms/types/core';
import type { SecretStore } from '@genii/config/secrets/types';
import type { ChannelConfig, TelegramChannelConfig } from '@genii/config/types/channel';
import { getSecretName } from '@genii/config/types/secret';
import type { ChannelFactory } from './types';

/**
 * Factory for creating Telegram channels.
 */
export class TelegramChannelFactory implements ChannelFactory {
	readonly type = 'telegram';

	/**
	 * Create a Telegram channel from configuration.
	 *
	 * @param id - The channel ID
	 * @param config - The channel configuration
	 * @param secretStore - Secret store for credential resolution
	 * @param logger - Logger instance for channel logging
	 * @returns A configured Telegram channel
	 */
	async create(id: string, config: ChannelConfig, secretStore: SecretStore, logger: Logger): Promise<Channel> {
		const telegramConfig = config as TelegramChannelConfig;

		// Resolve the bot token from the secret store
		const secretName = getSecretName(telegramConfig.credential);
		const result = await secretStore.get(secretName);

		if (!result.success) {
			throw new Error(`Failed to resolve credential for channel '${id}': ${result.error}`);
		}

		// Create the user allowlist filter
		const filter = new UserAllowlistFilter(new Set(telegramConfig.allowedUserIds));

		// Create the Telegram channel with the resolved token
		return new TelegramChannel(
			{
				token: result.value,
				pollingTimeout: Math.floor(telegramConfig.pollingIntervalMs / 1000) || 30,
			},
			id as ChannelId,
			filter,
			logger,
		);
	}
}
