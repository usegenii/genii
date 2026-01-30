/**
 * Channel list command and command group registration.
 * @module commands/channel/list
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import type { ChannelSummary } from '../../client';
import { createDaemonClient } from '../../client';
import type { ColumnDef } from '../../output/formatter';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { connectCommand } from './connect';
import { disconnectCommand } from './disconnect';
import { reconnectCommand } from './reconnect';
import { showCommand } from './show';

/**
 * Status colors for channel status.
 */
const STATUS_COLORS = {
	connected: chalk.green,
	connecting: chalk.yellow,
	reconnecting: chalk.yellow,
	disconnected: chalk.red,
	error: chalk.red,
} as const;

/**
 * Format status with appropriate color.
 */
function formatStatus(status: string): string {
	const colorFn = STATUS_COLORS[status as keyof typeof STATUS_COLORS];
	return colorFn ? colorFn(status) : status;
}

/**
 * List all channels.
 */
export function listCommand(channel: Command): void {
	channel
		.command('list')
		.alias('ls')
		.description('List all channels')
		.option('-a, --all', 'Include disconnected channels')
		.option('--status <status>', 'Filter by status (connected, disconnected, error)')
		.option('--type <type>', 'Filter by channel type')
		.action(async (options, cmd) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				let channels: ChannelSummary[] = await client.listChannels();

				// Apply filters
				if (!options.all) {
					// By default, hide disconnected channels unless --all is specified
					channels = channels.filter((ch) => ch.status !== 'disconnected');
				}

				if (options.status) {
					channels = channels.filter((ch) => ch.status === options.status);
				}

				if (options.type) {
					channels = channels.filter((ch) => ch.type === options.type);
				}

				// Define table columns
				const columns: ColumnDef[] = [
					{ header: 'ID', key: 'id' },
					{ header: 'Adapter', key: 'type' },
					{
						header: 'Status',
						key: 'status',
						transform: (value) => formatStatus(String(value)),
					},
				];

				formatter.table(channels, columns);
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exitCode = 1;
			} finally {
				await client.disconnect();
			}
		});
}

/**
 * Register all channel-related commands under the 'channel' command group.
 */
export function registerChannelCommands(program: Command): void {
	const channel = program.command('channel').alias('ch').description('Manage communication channels');

	listCommand(channel);
	showCommand(channel);
	connectCommand(channel);
	disconnectCommand(channel);
	reconnectCommand(channel);
}
