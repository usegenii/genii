/**
 * Channel connect command.
 * @module commands/channel/connect
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Connect a channel.
 */
export function connectCommand(channel: Command): void {
	channel
		.command('connect <channel-id>')
		.description('Connect a channel')
		.option('--force', 'Force reconnection if already connected')
		.option('--timeout <seconds>', 'Connection timeout', '30')
		.action(async (channelId: string, options, cmd) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient({
				requestTimeoutMs: Number.parseInt(options.timeout, 10) * 1000,
			});

			try {
				await client.connect();

				// If force option is set and channel is already connected, disconnect first
				if (options.force) {
					try {
						const channelDetails = await client.getChannel(channelId);
						if (channelDetails.status === 'connected') {
							formatter.message(`Disconnecting channel ${channelId}...`, 'info');
							await client.disconnectChannel(channelId);
						}
					} catch {
						// Channel might not exist or other error, continue with connect
					}
				}

				formatter.message(`Connecting channel ${channelId}...`, 'info');
				await client.connectChannel(channelId);

				formatter.message(`Channel ${channelId} connected successfully`, 'success');
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exitCode = 1;
			} finally {
				await client.disconnect();
			}
		});
}
