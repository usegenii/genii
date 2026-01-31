/**
 * User allowlist filter for Telegram updates.
 */

import type { TelegramUpdate } from '../adapters/telegram/types';
import type { InboundFilter } from './types';

/**
 * Filter that allows only updates from specific user IDs.
 *
 * When the allowlist is empty, all updates are allowed.
 * When the allowlist is non-empty, only updates from users in the list are processed.
 */
export class UserAllowlistFilter implements InboundFilter<TelegramUpdate> {
	private readonly allowedUserIds: Set<string>;

	constructor(allowedUserIds: Set<string>) {
		this.allowedUserIds = allowedUserIds;
	}

	/**
	 * Determine if an update should be processed based on user ID.
	 *
	 * @param update - The Telegram update to check
	 * @returns true if the user is allowed, false otherwise
	 */
	shouldProcess(update: TelegramUpdate): boolean {
		// Empty allowlist means allow all
		if (this.allowedUserIds.size === 0) {
			return true;
		}

		// Extract user ID from various update types
		const userId = update.message?.from?.id ?? update.callback_query?.from?.id ?? update.my_chat_member?.from?.id;

		// If no user ID is available, allow the update
		// (edge case for system messages or updates without a sender)
		if (userId === undefined) {
			return true;
		}

		return this.allowedUserIds.has(String(userId));
	}
}
