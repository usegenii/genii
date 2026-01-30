/**
 * Conversation show command.
 * @module commands/conversation/show
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Show details for a specific conversation.
 */
export function showCommand(conversation: Command): void {
	conversation
		.command('show <channel> <ref>')
		.description('Show conversation details')
		.option('--history', 'Include message history')
		.option('--limit <count>', 'Limit number of history entries', '50')
		.action(async (channel: string, ref: string, options) => {
			const globalOptions = conversation.parent?.opts() ?? {};
			const format = getOutputFormat(globalOptions);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				const includeHistory = options.history === true;
				const details = await client.getConversation(channel, ref, includeHistory);

				// Build key-value pairs for display
				const pairs: Array<[string, unknown]> = [
					['Channel ID', details.channelId],
					['Ref', details.ref],
					['Status', details.status],
					['Agent ID', details.agentId ?? '-'],
					['Message Count', details.messageCount],
					['Created At', details.createdAt],
					['Last Activity', details.lastMessageAt ?? '-'],
				];

				formatter.keyValue(pairs);

				// Show message history if requested
				if (includeHistory && details.history && details.history.length > 0) {
					const limit = Number.parseInt(options.limit, 10) || 50;
					const historyToShow = details.history.slice(0, limit);

					console.log(''); // Empty line separator
					console.log('Message History:');
					console.log('');

					for (const message of historyToShow) {
						const timestamp = new Date(message.timestamp).toLocaleString();
						console.log(`[${timestamp}] ${message.role}:`);
						console.log(`  ${message.content}`);
						console.log('');
					}

					if (details.history.length > limit) {
						console.log(`... and ${details.history.length - limit} more messages`);
					}
				}
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
