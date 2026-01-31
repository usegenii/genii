/**
 * Pulse command for triggering a pulse session manually.
 * @module commands/pulse
 */

import type { Command } from 'commander';
import { createDaemonClient, RpcResponseError } from '../client';
import { getFormatter, getOutputFormat } from '../output/formatter';

/**
 * Register the pulse command.
 */
export function registerPulseCommand(program: Command): void {
	program
		.command('pulse')
		.description('Trigger a pulse session immediately')
		.action(async (_options, cmd: Command) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();
			} catch {
				if (format === 'json') {
					formatter.error(new Error('Daemon is not running'));
				} else {
					formatter.message('Daemon is not running', 'error');
				}
				process.exit(1);
			}

			try {
				await client.triggerJob('pulse');

				if (format === 'json') {
					formatter.success({ triggered: true, job: 'pulse' });
				} else if (format === 'quiet') {
					formatter.raw('triggered');
				} else {
					formatter.message('Pulse triggered', 'success');
				}

				await client.disconnect();
			} catch (error) {
				await client.disconnect();

				if (error instanceof RpcResponseError) {
					if (format === 'json') {
						formatter.error(new Error(error.message));
					} else {
						formatter.message(error.message, 'error');
					}
				} else {
					formatter.error(error instanceof Error ? error : new Error(String(error)));
				}

				process.exit(1);
			}
		});
}
