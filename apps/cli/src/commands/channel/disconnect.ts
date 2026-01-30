/**
 * Channel disconnect command.
 * @module commands/channel/disconnect
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Disconnect a channel.
 */
export function disconnectCommand(channel: Command): void {
	channel
		.command('disconnect <channel-id>')
		.description('Disconnect a channel')
		.option('-f, --force', 'Force disconnect without graceful shutdown')
		.option('--reason <reason>', 'Reason for disconnection')
		.action(async (channelId: string, _options, cmd) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				formatter.message(`Disconnecting channel ${channelId}...`, 'info');

				// Note: force and reason options are available but the current RPC
				// API only supports basic disconnect. These can be extended later.
				await client.disconnectChannel(channelId);

				formatter.message(`Channel ${channelId} disconnected successfully`, 'success');
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exitCode = 1;
			} finally {
				await client.disconnect();
			}
		});
}
