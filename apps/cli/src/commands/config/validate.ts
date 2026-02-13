/**
 * Config validate command.
 * @module commands/config/validate
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { getDefaultBasePath } from '@genii/config/paths';
import chalk from 'chalk';
import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Configuration file definitions.
 */
const CONFIG_FILES = [
	{ name: 'providers', file: 'providers.toml', description: 'Provider configurations' },
	{ name: 'models', file: 'models.toml', description: 'Model configurations' },
	{ name: 'channels', file: 'channels.toml', description: 'Channel configurations' },
	{ name: 'preferences', file: 'preferences.toml', description: 'User preferences' },
];

/**
 * Check if a file exists.
 */
async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Validate configuration file.
 */
export function validateCommand(config: Command): void {
	config
		.command('validate')
		.description('Validate configuration files')
		.action(async () => {
			const globalOptions = config.parent?.opts() ?? {};
			const format = getOutputFormat(globalOptions);
			const formatter = getFormatter(format);

			const basePath = getDefaultBasePath();
			const results: Array<{ name: string; file: string; valid: boolean; error?: string; exists: boolean }> = [];
			let hasErrors = false;

			// First, try to validate via daemon if running
			const client = createDaemonClient();
			let daemonValidation: { valid: boolean; errors?: string[] } | null = null;

			try {
				await client.connect();
				daemonValidation = await client.validateConfig();
				await client.disconnect();
			} catch {
				// Daemon not running, will validate locally
			}

			if (daemonValidation) {
				// Use daemon validation results
				if (format === 'json') {
					formatter.success(daemonValidation);
				} else if (format === 'quiet') {
					if (!daemonValidation.valid) {
						console.error('invalid');
						process.exit(1);
					}
				} else {
					if (daemonValidation.valid) {
						console.log(`${chalk.green.bold('\u2713')} Configuration is valid`);
					} else {
						console.log(`${chalk.red.bold('\u2717')} Configuration has errors:`);
						for (const error of daemonValidation.errors ?? []) {
							console.log(`  ${chalk.red('\u2022')} ${error}`);
						}
						process.exit(1);
					}
				}
				return;
			}

			// Validate locally by attempting to load each config file
			for (const configFile of CONFIG_FILES) {
				const filePath = join(basePath, configFile.file);
				const exists = await fileExists(filePath);

				if (!exists) {
					results.push({
						name: configFile.name,
						file: configFile.file,
						valid: true,
						exists: false,
					});
					continue;
				}

				try {
					// Dynamically import the config module
					const { loadConfig } = await import('@genii/config/config');
					await loadConfig({ basePath });

					results.push({
						name: configFile.name,
						file: configFile.file,
						valid: true,
						exists: true,
					});
				} catch (error) {
					hasErrors = true;
					results.push({
						name: configFile.name,
						file: configFile.file,
						valid: false,
						error: error instanceof Error ? error.message : String(error),
						exists: true,
					});
				}
			}

			if (format === 'json') {
				formatter.success({
					valid: !hasErrors,
					basePath,
					files: results,
				});
			} else if (format === 'quiet') {
				if (hasErrors) {
					console.error('invalid');
					process.exit(1);
				}
			} else {
				console.log(`Configuration Directory: ${basePath}`);
				console.log('');

				for (const result of results) {
					if (!result.exists) {
						console.log(
							`${chalk.gray('\u25CB')} ${result.name} (${result.file}) - ${chalk.gray('not found')}`,
						);
					} else if (result.valid) {
						console.log(
							`${chalk.green('\u2713')} ${result.name} (${result.file}) - ${chalk.green('valid')}`,
						);
					} else {
						console.log(`${chalk.red('\u2717')} ${result.name} (${result.file}) - ${chalk.red('invalid')}`);
						console.log(`    ${chalk.red(result.error)}`);
					}
				}

				if (hasErrors) {
					process.exit(1);
				}
			}
		});
}
