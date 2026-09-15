/**
 * Channel show command.
 * @module commands/channel/show
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { handleError } from '../../utils/errors';

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
		.action(async (channelId: string, _options, cmd) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				const channelDetails = await client.getChannel(channelId);

				const sanitizedConfig = channelDetails.config ? sanitizeConfig(channelDetails.config) : undefined;
				const outputDetails =
					sanitizedConfig === undefined ? channelDetails : { ...channelDetails, config: sanitizedConfig };

				if (format === 'json') {
					formatter.success(outputDetails);
				} else if (format === 'quiet') {
					formatter.raw(channelDetails.id);
				} else {
					const pairs: Array<[string, unknown]> = [
						['Channel ID', channelDetails.id],
						['Adapter', channelDetails.type],
						['Status', formatStatus(channelDetails.status)],
					];

					if (channelDetails.registeredAt) {
						pairs.push(['Registered At', channelDetails.registeredAt]);
					}

					formatter.keyValue(pairs);

					if (sanitizedConfig && Object.keys(sanitizedConfig).length > 0) {
						console.log('');
						console.log(chalk.bold('Configuration:'));
						console.log(formatValue(sanitizedConfig));
					}
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
