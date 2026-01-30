/**
 * Conversation unbind command.
 * @module commands/conversation/unbind
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Unbind a conversation from its agent.
 */
export function unbindCommand(conversation: Command): void {
	conversation
		.command('unbind <channel> <ref>')
		.description('Unbind a conversation from its agent')
		.action(async (channel: string, ref: string) => {
			const globalOptions = conversation.parent?.opts() ?? {};
			const format = getOutputFormat(globalOptions);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				await client.unbindConversation(channel, ref);

				formatter.message(`Unbound agent from conversation ${channel}:${ref}`, 'success');
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
