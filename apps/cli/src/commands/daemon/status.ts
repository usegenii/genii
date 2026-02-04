/**
 * Daemon status command.
 * @module commands/daemon/status
 */

import type { Command } from 'commander';
import { createDaemonClient, type DaemonStatus } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { formatUptime } from '../../utils/time';

interface StatusOptions {
	watch?: boolean;
	interval?: string;
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
	const units = ['B', 'KB', 'MB', 'GB'];
	let unitIndex = 0;
	let value = bytes;

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}

	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Display daemon status in human-readable format.
 */
function displayStatus(status: DaemonStatus, formatter: ReturnType<typeof getFormatter>): void {
	formatter.keyValue([
		['Status', 'running'],
		['Version', status.version],
		['PID', status.pid],
		['Uptime', formatUptime(status.uptime)],
		['Agents', status.agentCount],
		['Channels', status.channelCount],
		['Conversations', status.conversationCount],
		['Heap Used', formatBytes(status.memoryUsage.heapUsed)],
		['Heap Total', formatBytes(status.memoryUsage.heapTotal)],
		['RSS', formatBytes(status.memoryUsage.rss)],
	]);
}

/**
 * Get the status of the Genii daemon.
 */
export function statusCommand(daemon: Command): void {
	daemon
		.command('status')
		.description('Show daemon status')
		.option('--watch', 'Watch status and refresh periodically')
		.option('--interval <seconds>', 'Refresh interval for watch mode', '2')
		.action(async (options: StatusOptions, cmd: Command) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();
			} catch {
				if (format === 'json') {
					formatter.success({
						running: false,
						status: 'not_running',
					});
				} else if (format === 'quiet') {
					formatter.raw('stopped');
				} else {
					formatter.message('Daemon is not running', 'warning');
				}
				return;
			}

			try {
				if (options.watch) {
					// Watch mode - continuously display status
					const interval = parseInt(options.interval ?? '2', 10) * 1000;

					const refreshStatus = async (): Promise<void> => {
						try {
							const status = await client.status();

							// Clear screen for human format
							if (format === 'human') {
								process.stdout.write('\x1b[2J\x1b[H');
								console.log('Daemon Status (watching, Ctrl+C to exit)\n');
							}

							if (format === 'json') {
								formatter.success({ running: true, ...status });
							} else if (format === 'quiet') {
								formatter.raw('running');
							} else {
								displayStatus(status, formatter);
							}
						} catch (error) {
							formatter.error(error instanceof Error ? error : new Error(String(error)));
						}
					};

					// Initial display
					await refreshStatus();

					// Set up interval for continuous updates
					const timer = setInterval(refreshStatus, interval);

					// Handle Ctrl+C
					process.on('SIGINT', async () => {
						clearInterval(timer);
						await client.disconnect();
						process.exit(0);
					});

					// Keep the process running
					await new Promise(() => {});
				} else {
					// Single status check
					const status = await client.status();

					if (format === 'json') {
						formatter.success({ running: true, ...status });
					} else if (format === 'quiet') {
						formatter.raw('running');
					} else {
						displayStatus(status, formatter);
					}

					await client.disconnect();
				}
			} catch (error) {
				await client.disconnect();
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			}
		});
}
