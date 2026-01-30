/**
 * Telegram adapter factory.
 */

import type { Channel, ChannelAdapter } from '../../channel/types';
import { TelegramChannel } from './channel';
import type { TelegramConfig } from './types';

/**
 * Adapter for creating Telegram channel instances.
 */
export class TelegramAdapter implements ChannelAdapter<TelegramConfig> {
	readonly name = 'telegram';

	/**
	 * Create a new Telegram channel instance.
	 */
	create(config: TelegramConfig): Channel {
		return new TelegramChannel(config);
	}
}

/**
 * Create a TelegramAdapter instance.
 */
export function createTelegramAdapter(): TelegramAdapter {
	return new TelegramAdapter();
}
