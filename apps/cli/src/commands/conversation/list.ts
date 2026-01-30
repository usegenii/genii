/**
 * Conversation list command and command group registration.
 * @module commands/conversation/list
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import type { ColumnDef } from '../../output/formatter';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { showCommand } from './show';
import { unbindCommand } from './unbind';

/**
 * List all conversations.
 */
export function listCommand(conversation: Command): void {
	conversation
		.command('list')
		.alias('ls')
		.description('List all conversations')
		.option('--channel <channel-id>', 'Filter by channel')
		.option('--has-agent', 'Only show conversations with bound agents')
		.option('--no-agent', 'Only show conversations without bound agents')
		.action(async (options) => {
			const globalOptions = conversation.parent?.opts() ?? {};
			const format = getOutputFormat(globalOptions);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				// Build filter based on options
				const filter: { channelId?: string; agentId?: string } = {};

				if (options.channel) {
					filter.channelId = options.channel;
				}

				let conversations = await client.listConversations(filter);

				// Filter by agent presence if specified
				if (options.hasAgent) {
					conversations = conversations.filter((c) => c.agentId !== undefined && c.agentId !== null);
				} else if (options.agent === false) {
					// --no-agent sets options.agent to false
					conversations = conversations.filter((c) => c.agentId === undefined || c.agentId === null);
				}

				const columns: ColumnDef[] = [
					{ header: 'Channel', key: 'channelId' },
					{ header: 'Ref', key: 'ref' },
					{
						header: 'Agent ID',
						key: 'agentId',
						transform: (value) => (value ? String(value) : '-'),
					},
					{ header: 'Created', key: 'createdAt' },
					{ header: 'Last Activity', key: 'lastMessageAt' },
				];

				formatter.table(conversations, columns);
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}

/**
 * Register all conversation-related commands under the 'conversation' command group.
 */
export function registerConversationCommands(program: Command): void {
	const conversation = program.command('conversation').alias('conv').description('Manage conversations');

	listCommand(conversation);
	showCommand(conversation);
	unbindCommand(conversation);
}
