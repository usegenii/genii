/**
 * Channel reconnect command.
 * @module commands/channel/reconnect
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reconnect a channel.
 */
export function reconnectCommand(channel: Command): void {
	channel
		.command('reconnect <channel-id>')
		.description('Reconnect a channel (disconnect then connect)')
		.option('--timeout <seconds>', 'Connection timeout', '30')
		.option('--delay <seconds>', 'Delay between disconnect and connect', '1')
		.action(async (channelId: string, options, cmd) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const delayMs = Number.parseInt(options.delay, 10) * 1000;
			const client = createDaemonClient({
				requestTimeoutMs: Number.parseInt(options.timeout, 10) * 1000,
			});

			try {
				await client.connect();

				formatter.message(`Reconnecting channel ${channelId}...`, 'info');

				// Use the daemon's reconnect RPC method which handles the full cycle
				await client.reconnectChannel(channelId);

				// If there's a delay configured and we want to wait before confirming
				if (delayMs > 0) {
					await sleep(delayMs);
				}

				formatter.message(`Channel ${channelId} reconnected successfully`, 'success');
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exitCode = 1;
			} finally {
				await client.disconnect();
			}
		});
}
