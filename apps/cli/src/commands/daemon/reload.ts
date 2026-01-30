/**
 * Daemon reload command.
 * @module commands/daemon/reload
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { createSpinner } from '../../utils/spinner';

interface ReloadOptions {
	validate?: boolean;
}

/**
 * Reload daemon configuration.
 */
export function reloadCommand(daemon: Command): void {
	daemon
		.command('reload')
		.description('Reload daemon configuration without restart')
		.option('--validate', 'Validate configuration without applying')
		.action(async (options: ReloadOptions, cmd: Command) => {
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
				if (options.validate) {
					// Validate configuration only
					const spinner = createSpinner({ text: 'Validating configuration...' });
					spinner.start();

					const result = await client.validateConfig();

					if (result.valid) {
						spinner.succeed('Configuration is valid');
						if (format === 'json') {
							formatter.success({ valid: true });
						}
					} else {
						spinner.fail('Configuration is invalid');
						if (format === 'json') {
							formatter.success({ valid: false, errors: result.errors });
						} else {
							formatter.message('Configuration errors:', 'error');
							for (const error of result.errors ?? []) {
								formatter.message(`  - ${error}`, 'error');
							}
						}
						process.exit(1);
					}
				} else {
					// Reload configuration
					const spinner = createSpinner({ text: 'Reloading configuration...' });
					spinner.start();

					const result = await client.reload();

					spinner.succeed('Configuration reloaded');

					if (format === 'json') {
						formatter.success({
							reloaded: true,
							components: result.reloaded,
						});
					} else if (format === 'human') {
						if (result.reloaded.length > 0) {
							formatter.message('Reloaded components:', 'info');
							formatter.list(result.reloaded, (component) => component);
						} else {
							formatter.message('No components required reloading', 'info');
						}
					} else if (format === 'quiet') {
						formatter.raw('reloaded');
					}
				}

				await client.disconnect();
			} catch (error) {
				await client.disconnect();
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			}
		});
}
