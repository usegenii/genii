/**
 * Channel show command.
 * @module commands/channel/show
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

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
 * Sanitize configuration to remove secrets.
 * Replaces values of keys that look like secrets with asterisks.
 */
function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
	const secretKeys = ['password', 'secret', 'token', 'key', 'apikey', 'api_key', 'credential', 'auth'];
	const sanitized: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(config)) {
		const lowerKey = key.toLowerCase();
		const isSecret = secretKeys.some((sk) => lowerKey.includes(sk));

		if (isSecret && typeof value === 'string' && value.length > 0) {
			sanitized[key] = '********';
		} else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			sanitized[key] = sanitizeConfig(value as Record<string, unknown>);
		} else {
			sanitized[key] = value;
		}
	}

	return sanitized;
}

/**
 * Format a value for display.
 */
function formatValue(value: unknown): string {
	if (value === null || value === undefined) {
		return chalk.gray('-');
	}
	if (typeof value === 'object') {
		return chalk.gray(JSON.stringify(value, null, 2));
	}
	return String(value);
}

/**
 * Show details for a specific channel.
 */
export function showCommand(channel: Command): void {
	channel
		.command('show <channel-id>')
		.description('Show channel details')
		.option('--include-metrics', 'Include connection metrics')
		.option('--include-history', 'Include recent message history')
		.action(async (channelId: string, options, cmd) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				const channelDetails = await client.getChannel(channelId);

				// Sanitize config to hide secrets
				const sanitizedConfig = sanitizeConfig(channelDetails.config);

				if (format === 'json') {
					// For JSON output, return the full object with sanitized config
					formatter.success({
						...channelDetails,
						config: sanitizedConfig,
					});
				} else if (format === 'quiet') {
					// For quiet mode, just output the ID
					formatter.raw(channelDetails.id);
				} else {
					// Human-readable format
					const pairs: Array<[string, unknown]> = [
						['Channel ID', channelDetails.id],
						['Adapter', channelDetails.type],
						['Status', formatStatus(channelDetails.status)],
						['Bound Conversations', channelDetails.conversationCount],
					];

					if (channelDetails.lastMessageAt) {
						pairs.push(['Last Message', channelDetails.lastMessageAt]);
					}

					formatter.keyValue(pairs);

					// Show configuration
					if (Object.keys(sanitizedConfig).length > 0) {
						console.log('');
						console.log(chalk.bold('Configuration:'));
						console.log(formatValue(sanitizedConfig));
					}

					// Show metadata if present
					if (channelDetails.metadata && Object.keys(channelDetails.metadata).length > 0) {
						console.log('');
						console.log(chalk.bold('Metadata:'));
						console.log(formatValue(channelDetails.metadata));
					}

					// Show metrics if requested and available
					if (options.includeMetrics && 'metrics' in channelDetails) {
						console.log('');
						console.log(chalk.bold('Metrics:'));
						console.log(formatValue((channelDetails as Record<string, unknown>).metrics));
					}
				}
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exitCode = 1;
			} finally {
				await client.disconnect();
			}
		});
}
