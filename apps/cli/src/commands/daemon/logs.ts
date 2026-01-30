/**
 * Daemon logs command.
 * @module commands/daemon/logs
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { formatTimestamp } from '../../utils/time';

interface LogsOptions {
	follow?: boolean;
	lines?: string;
	level?: string;
	component?: string;
	since?: string;
}

/**
 * Log level colors for pretty printing.
 */
const LEVEL_COLORS: Record<string, (text: string) => string> = {
	trace: chalk.gray,
	debug: chalk.blue,
	info: chalk.green,
	warn: chalk.yellow,
	error: chalk.red,
	fatal: chalk.bgRed.white,
};

/**
 * Format a log entry for human-readable output.
 */
function formatLogEntry(entry: LogEntry): string {
	// Convert string timestamp to Date or number
	const ts = typeof entry.timestamp === 'string' ? new Date(entry.timestamp) : entry.timestamp;
	const timestamp = chalk.gray(formatTimestamp(ts));
	const levelColor = LEVEL_COLORS[entry.level] ?? chalk.white;
	const level = levelColor(entry.level.toUpperCase().padEnd(5));
	const component = entry.component ? chalk.cyan(`[${entry.component}]`) : '';
	const message = entry.message;

	return `${timestamp} ${level} ${component} ${message}`.trim();
}

/**
 * Log entry structure from daemon.
 */
interface LogEntry {
	timestamp: string | number;
	level: string;
	component?: string;
	message: string;
	data?: unknown;
}

/**
 * Filter for log subscriptions.
 */
interface LogFilter {
	level?: string;
	component?: string;
	since?: string;
	limit?: number;
}

/**
 * View daemon logs.
 */
export function logsCommand(daemon: Command): void {
	daemon
		.command('logs')
		.description('View daemon logs')
		.option('-f, --follow', 'Follow log output')
		.option('-n, --lines <count>', 'Number of lines to show', '50')
		.option('--level <level>', 'Filter by log level (trace, debug, info, warn, error)')
		.option('--component <name>', 'Filter by component name')
		.option('--since <time>', 'Show logs since timestamp (e.g., "1h", "2024-01-01")')
		.action(async (options: LogsOptions, cmd: Command) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();
			} catch {
				formatter.message('Daemon is not running', 'error');
				process.exit(1);
			}

			try {
				const filter: LogFilter = {
					level: options.level,
					component: options.component,
					since: options.since,
					limit: parseInt(options.lines ?? '50', 10),
				};

				if (options.follow) {
					// Subscribe to log notifications
					const subscriptionId = await client.subscribe('logs', filter);

					// Set up notification handler
					const unsubscribe = client.onNotification((method, params) => {
						if (method === 'log') {
							const entry = params as LogEntry;

							if (format === 'json') {
								console.log(JSON.stringify(entry));
							} else if (format === 'quiet') {
								console.log(entry.message);
							} else {
								console.log(formatLogEntry(entry));
							}
						}
					});

					// Show initial message
					if (format === 'human') {
						formatter.message('Following daemon logs (Ctrl+C to exit)', 'info');
						console.log('');
					}

					// Handle Ctrl+C
					process.on('SIGINT', async () => {
						unsubscribe();
						try {
							await client.unsubscribe(subscriptionId);
						} catch {
							// Ignore errors during cleanup
						}
						await client.disconnect();
						process.exit(0);
					});

					// Keep the process running
					await new Promise(() => {});
				} else {
					// Single request for recent logs
					// This would typically be a separate RPC method like 'logs.recent'
					// For now, we'll subscribe briefly and then unsubscribe

					const entries: LogEntry[] = [];
					const limit = parseInt(options.lines ?? '50', 10);

					// Subscribe to get initial logs
					const subscriptionId = await client.subscribe('logs', {
						...filter,
						limit,
						includeRecent: true,
					});

					// Collect entries with a timeout
					const collectPromise = new Promise<void>((resolve) => {
						const timeout = setTimeout(resolve, 2000);

						const unsubscribe = client.onNotification((method, params) => {
							if (method === 'log' || method === 'logs.entry') {
								entries.push(params as LogEntry);
								if (entries.length >= limit) {
									clearTimeout(timeout);
									unsubscribe();
									resolve();
								}
							} else if (method === 'logs.complete') {
								clearTimeout(timeout);
								unsubscribe();
								resolve();
							}
						});
					});

					await collectPromise;

					// Unsubscribe
					try {
						await client.unsubscribe(subscriptionId);
					} catch {
						// Ignore errors
					}

					// Display collected logs
					if (entries.length === 0) {
						if (format === 'human') {
							formatter.message('No log entries found', 'info');
						} else if (format === 'json') {
							formatter.success({ logs: [] });
						}
					} else {
						if (format === 'json') {
							formatter.success({ logs: entries });
						} else if (format === 'quiet') {
							for (const entry of entries) {
								console.log(entry.message);
							}
						} else {
							for (const entry of entries) {
								console.log(formatLogEntry(entry));
							}
						}
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
