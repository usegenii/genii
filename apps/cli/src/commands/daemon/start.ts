/**
 * Daemon start command and command group registration.
 * @module commands/daemon/start
 */

import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { createDaemonClient, getSocketPath } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { createSpinner } from '../../utils/spinner';
import { logsCommand } from './logs';
import { reloadCommand } from './reload';
import { statusCommand } from './status';
import { stopCommand } from './stop';

/**
 * Check if the daemon is already running by attempting to ping it.
 */
async function isDaemonRunning(): Promise<boolean> {
	const client = createDaemonClient();
	try {
		await client.connect();
		await client.ping();
		await client.disconnect();
		return true;
	} catch {
		return false;
	}
}

/**
 * Wait for the daemon to become available.
 */
async function waitForDaemon(timeoutMs: number = 5000): Promise<boolean> {
	const startTime = Date.now();
	const pollInterval = 100;

	while (Date.now() - startTime < timeoutMs) {
		if (await isDaemonRunning()) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}

	return false;
}


interface StartOptions {
	foreground?: boolean;
	background?: boolean;
	data?: string;
	guidance?: string;
}

/**
 * Start the Genii daemon.
 */
export function startCommand(daemon: Command): void {
	daemon
		.command('start')
		.description('Start the Genii daemon')
		.option('-f, --foreground', 'Run in foreground (do not daemonize)')
		.option('-b, --background', 'Run in background (default)')
		.option('-d, --data <path>', 'Path to data directory (config, conversations, snapshots, guidance)')
		.option('-g, --guidance <path>', 'Override guidance directory (defaults to {data}/guidance)')
		.action(async (options: StartOptions, cmd: Command) => {
			const globalOpts = cmd.optsWithGlobals();
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			// Check if daemon is already running
			const running = await isDaemonRunning();
			if (running) {
				formatter.message('Daemon is already running', 'info');
				return;
			}

			// Foreground mode: run in current process (not implemented yet)
			if (options.foreground) {
				formatter.message('Starting daemon in foreground...', 'info');
				formatter.error('Foreground mode not yet implemented. Use background mode.');
				process.exit(1);
			}

			// Background mode (default)
			const spinner = createSpinner({ text: 'Starting daemon...' });
			spinner.start();

			try {
				const socketPath = getSocketPath();

				// Build command line arguments for the daemon
				const daemonArgs: string[] = [];
				daemonArgs.push('--socket', socketPath);
				if (options.data) {
					daemonArgs.push('--data', options.data);
				}
				if (options.guidance) {
					daemonArgs.push('--guidance', options.guidance);
				}

				// Spawn the genii-daemon binary detached
				const child = spawn('genii-daemon', daemonArgs, {
					detached: true,
					stdio: 'ignore',
				});

				// Unref so parent can exit
				child.unref();

				// Wait for daemon to become available
				const started = await waitForDaemon(5000);

				if (started) {
					spinner.succeed('Daemon started successfully');
					if (format === 'json') {
						formatter.success({ started: true, pid: child.pid });
					}
				} else {
					spinner.fail('Daemon failed to start');
					formatter.error('Daemon process started but is not responding');
					process.exit(1);
				}
			} catch (error) {
				spinner.fail('Failed to start daemon');
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			}
		});
}

/**
 * Register all daemon-related commands under the 'daemon' command group.
 */
export function registerDaemonCommands(program: Command): void {
	const daemon = program.command('daemon').description('Manage the Genii daemon process');

	startCommand(daemon);
	stopCommand(daemon);
	statusCommand(daemon);
	logsCommand(daemon);
	reloadCommand(daemon);
}
