/**
 * Daemon stop command.
 * @module commands/daemon/stop
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { createSpinner } from '../../utils/spinner';

interface StopOptions {
	force?: boolean;
	timeout?: string;
}

/**
 * Wait for the daemon to stop responding.
 */
async function waitForDaemonStop(timeoutMs: number): Promise<boolean> {
	const startTime = Date.now();
	const pollInterval = 500;
	const client = createDaemonClient();

	while (Date.now() - startTime < timeoutMs) {
		try {
			await client.connect();
			await client.ping();
			await client.disconnect();
			// Still running, wait and try again
			await new Promise((resolve) => setTimeout(resolve, pollInterval));
		} catch {
			// Connection failed, daemon has stopped
			return true;
		}
	}

	return false;
}

/**
 * Stop the Geniigotchi daemon.
 */
export function stopCommand(daemon: Command): void {
	daemon
		.command('stop')
		.description('Stop the Geniigotchi daemon')
		.option('-f, --force', 'Force stop without graceful shutdown')
		.option('--timeout <ms>', 'Timeout for graceful shutdown in milliseconds', '30000')
		.action(async (options: StopOptions, cmd: Command) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);
			const timeout = parseInt(options.timeout ?? '30000', 10);

			const spinner = createSpinner({ text: 'Stopping daemon...' });
			spinner.start();

			const client = createDaemonClient();

			try {
				await client.connect();
			} catch {
				spinner.fail('Daemon is not running');
				if (format === 'json') {
					formatter.success({ stopped: false, reason: 'not_running' });
				}
				return;
			}

			try {
				const mode = options.force ? 'hard' : 'graceful';
				spinner.text = options.force ? 'Force stopping daemon...' : 'Gracefully stopping daemon...';

				// Send shutdown command
				await client.shutdown(mode, timeout);

				// Disconnect immediately since daemon will be shutting down
				try {
					await client.disconnect();
				} catch {
					// Expected - daemon is shutting down
				}

				// Wait for daemon to actually stop
				spinner.text = 'Waiting for daemon to stop...';
				const stopped = await waitForDaemonStop(timeout);

				if (stopped) {
					spinner.succeed('Daemon stopped successfully');
					if (format === 'json') {
						formatter.success({ stopped: true, mode });
					}
				} else {
					spinner.fail('Daemon stop timed out');
					formatter.error('Daemon did not stop within the timeout period');
					process.exit(1);
				}
			} catch (error) {
				spinner.fail('Failed to stop daemon');
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			}
		});
}
