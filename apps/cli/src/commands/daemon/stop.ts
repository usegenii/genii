/**
 * Daemon stop command.
 * @module commands/daemon/stop
 */

import { DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS } from '@genii/lib/rpc/methods';
import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { createSpinner } from '../../utils/spinner';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface StopOptions {
	force?: boolean;
	timeout?: string;
}

/**
 * Parse an exact nonnegative integer that Node can use as a timer delay.
 */
function parseTimeoutMs(value: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(`Invalid timeout "${value}": expected an integer from 0 to ${MAX_TIMER_DELAY_MS} milliseconds`);
	}

	const timeoutMs = Number(value);
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_TIMER_DELAY_MS) {
		throw new Error(`Invalid timeout "${value}": expected an integer from 0 to ${MAX_TIMER_DELAY_MS} milliseconds`);
	}

	return timeoutMs;
}

/**
 * Check whether connecting failed because no daemon is listening.
 */
function isDaemonNotRunning(error: unknown): boolean {
	if (!(error instanceof Error) || !('code' in error)) {
		return false;
	}

	const code = String(error.code);
	return code === 'ENOENT' || code === 'ECONNREFUSED';
}

/**
 * Stop the Genii daemon.
 */
export function stopCommand(daemon: Command): void {
	daemon
		.command('stop')
		.description('Stop the Genii daemon')
		.option('-f, --force', 'Force stop without graceful shutdown')
		.option(
			'--timeout <ms>',
			'Timeout for graceful shutdown in milliseconds',
			String(DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS),
		)
		.action(async (options: StopOptions, cmd: Command) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);
			let timeoutMs: number;
			try {
				timeoutMs = parseTimeoutMs(options.timeout ?? String(DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS));
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exitCode = 1;
				return;
			}

			const spinner = createSpinner({ text: 'Stopping daemon...' });
			if (format === 'human') {
				spinner.start();
			}

			const client = createDaemonClient();

			try {
				await client.connect();
			} catch (error) {
				if (!isDaemonNotRunning(error)) {
					if (format === 'human') {
						spinner.fail('Failed to stop daemon');
					}
					formatter.error(error instanceof Error ? error : new Error(String(error)));
					process.exitCode = 1;
					return;
				}

				if (format === 'human') {
					spinner.info('Daemon is not running');
				}
				if (format === 'json') {
					formatter.success({ stopped: false, reason: 'not_running' });
				} else if (format === 'quiet') {
					formatter.raw('not_running');
				}
				return;
			}

			try {
				spinner.text = options.force ? 'Force stopping daemon...' : 'Gracefully stopping daemon...';

				const result = await client.shutdown({
					graceful: options.force !== true,
					timeoutMs,
				});

				if (result.ok !== true || (result.termination !== 'graceful' && result.termination !== 'forced')) {
					throw new Error('Daemon returned an invalid shutdown result');
				}

				if (format === 'human') {
					spinner.succeed(`Daemon stopped: ${result.termination} termination`);
				} else if (format === 'json') {
					formatter.success({ stopped: true, mode: result.termination });
				} else {
					formatter.raw(result.termination);
				}
			} catch (error) {
				if (format === 'human') {
					spinner.fail('Failed to stop daemon');
				}
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exitCode = 1;
			} finally {
				try {
					await client.disconnect();
				} catch {
					// The daemon may close the socket as it completes shutdown.
				}
			}
		});
}
