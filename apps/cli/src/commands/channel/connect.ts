/**
 * Channel connect command.
 * @module commands/channel/connect
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { handleError } from '../../utils/errors';

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
							if (format === 'human') {
								formatter.message(`Disconnecting channel ${channelId}...`, 'info');
							}
							await client.disconnectChannel(channelId);
						}
					} catch {
						// Channel might not exist or other error, continue with connect
					}
				}

				if (format === 'human') {
					formatter.message(`Connecting channel ${channelId}...`, 'info');
				}
				const result = await client.connectChannel(channelId);

				if (format === 'json') {
					formatter.success(result);
				} else if (format === 'human') {
					formatter.message(`Channel ${channelId} connected successfully`, 'success');
				}
			} catch (error) {
				const { exitCode } = handleError(error);
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exitCode = exitCode;
			} finally {
				await client.disconnect();
			}
		});
}
