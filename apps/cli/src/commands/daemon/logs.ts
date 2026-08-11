/**
 * Daemon logs command.
 * @module commands/daemon/logs
 */

import type { LogEntry, RpcLogLevel, RpcMethods } from '@genii/lib/rpc/methods';
import type { RpcNotificationParams } from '@genii/lib/rpc/notifications';
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

const LOG_LEVELS: RpcLogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function parseLogLevel(level: string | undefined): RpcLogLevel | undefined {
	if (level === undefined) {
		return undefined;
	}
	if (!LOG_LEVELS.includes(level as RpcLogLevel)) {
		throw new Error(`Invalid log level: ${level}. Valid levels: ${LOG_LEVELS.join(', ')}`);
	}
	return level as RpcLogLevel;
}

function parseLineCount(lines: string | undefined): number {
	const count = Number.parseInt(lines ?? '50', 10);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error(`Invalid line count: ${lines ?? ''}`);
	}
	return count;
}

function orderAndDedupeEntries(entries: LogEntry[]): LogEntry[] {
	const bySequence = new Map<number, LogEntry>();
	for (const entry of entries) {
		bySequence.set(entry.sequence, entry);
	}
	return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

/**
 * Format a log entry for human-readable output.
 */
function formatLogEntry(entry: LogEntry): string {
	const timestamp = chalk.gray(formatTimestamp(entry.timestamp));
	const levelColor = LEVEL_COLORS[entry.level] ?? chalk.white;
	const level = levelColor(entry.level.toUpperCase().padEnd(5));
	const component = entry.component ? chalk.cyan(`[${entry.component}]`) : '';
	const message = entry.message;

	return `${timestamp} ${level} ${component} ${message}`.trim();
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
			let subscriptionId: string | null = null;
			let unsubscribeNotification: (() => void) | null = null;
			let signalHandler: (() => void) | null = null;
			let cleanupPromise: Promise<void> | null = null;
			let resolveStop: () => void = () => {};
			const stopped = new Promise<void>((resolve) => {
				resolveStop = resolve;
			});

			const cleanup = (): Promise<void> => {
				if (cleanupPromise) {
					return cleanupPromise;
				}

				cleanupPromise = (async () => {
					if (signalHandler) {
						process.off('SIGINT', signalHandler);
						process.off('SIGTERM', signalHandler);
					}
					unsubscribeNotification?.();
					unsubscribeNotification = null;
					if (subscriptionId && client.connected) {
						try {
							await client.unsubscribe(subscriptionId);
						} catch {
							// Ignore cleanup races with disconnect or daemon shutdown.
						}
					}
					await client.disconnect();
				})();

				return cleanupPromise;
			};

			signalHandler = resolveStop;
			process.on('SIGINT', signalHandler);
			process.on('SIGTERM', signalHandler);

			try {
				await client.connect();
			} catch {
				formatter.message('Daemon is not running', 'error');
				process.exit(1);
			}

			try {
				const request: RpcMethods['subscribe.logs'] = {
					level: parseLogLevel(options.level),
					component: options.component,
					since: options.since,
					limit: parseLineCount(options.lines),
					follow: options.follow ?? false,
				};
				const bufferedNotifications: RpcNotificationParams['logs.entry'][] = [];
				let lastSequence = -1;
				let replaying = true;

				const writeFollowEntry = (entry: LogEntry): void => {
					if (entry.sequence <= lastSequence) {
						return;
					}
					lastSequence = entry.sequence;

					if (format === 'json') {
						console.log(JSON.stringify(entry));
					} else if (format === 'quiet') {
						console.log(entry.message);
					} else {
						console.log(formatLogEntry(entry));
					}
				};

				unsubscribeNotification = client.onNotification((notification) => {
					if (notification.method !== 'logs.entry') {
						return;
					}
					if (subscriptionId === null || replaying) {
						bufferedNotifications.push(notification.params);
						return;
					}
					if (notification.params.subscriptionId !== subscriptionId) {
						return;
					}
					writeFollowEntry(notification.params.entry);
				});

				const result = await client.subscribeLogs(request);
				subscriptionId = result.subscriptionId;

				if (options.follow) {
					// Show initial message
					if (format === 'human') {
						formatter.message('Following daemon logs (Ctrl+C to exit)', 'info');
						console.log('');
					}

					const bufferedForSubscription = bufferedNotifications
						.filter((notification) => notification.subscriptionId === subscriptionId)
						.map((notification) => notification.entry);
					bufferedNotifications.length = 0;
					for (const entry of orderAndDedupeEntries([...result.entries, ...bufferedForSubscription])) {
						writeFollowEntry(entry);
					}
					replaying = false;
					await stopped;
				} else {
					replaying = false;
					const entries = orderAndDedupeEntries(result.entries);

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
				}
				await cleanup();
			} catch (error) {
				await cleanup();
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			}
		});
}
