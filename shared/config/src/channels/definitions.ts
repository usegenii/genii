import type { ChannelDefinition } from './types.js';

// Re-export types for convenience
export type { ChannelDefinition, SetupField, SetupFieldOption, SetupFieldType } from './types.js';

/**
 * Built-in channel definitions.
 * Currently only Telegram is supported.
 */
export const CHANNEL_DEFINITIONS: ChannelDefinition[] = [
	{
		id: 'telegram',
		name: 'Telegram',
		description: 'Telegram bot for messaging',
		credentialField: {
			id: 'botToken',
			type: 'password',
			label: 'Bot Token',
			placeholder: 'Enter your Telegram bot token',
			hint: 'Your token will be stored securely',
			required: true,
		},
		fields: [
			{
				id: 'allowedUserIds',
				type: 'text',
				label: 'Allowed User IDs',
				placeholder: 'Comma-separated Telegram user IDs',
				hint: 'Only these users can interact with the bot',
				required: true,
			},
			{
				id: 'pollingIntervalMs',
				type: 'text',
				label: 'Polling Interval (ms)',
				placeholder: '1000',
				hint: 'How often to check for new messages',
			},
		],
		defaults: {
			pollingIntervalMs: '1000',
		},
	},
];

/**
 * Get a channel definition by type ID.
 */
export function getChannelDefinition(id: string): ChannelDefinition | undefined {
	return CHANNEL_DEFINITIONS.find((c) => c.id === id);
}

/**
 * Get all channel definitions.
 */
export function getAllChannelDefinitions(): ChannelDefinition[] {
	return [...CHANNEL_DEFINITIONS];
}
