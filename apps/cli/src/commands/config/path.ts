/**
 * Config path command.
 * @module commands/config/path
 */

import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
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
 * Show configuration file path.
 */
export function pathCommand(config: Command): void {
	config
		.command('path')
		.description('Show configuration directory and file paths')
		.action(async () => {
			const globalOptions = config.parent?.opts() ?? {};
			const format = getOutputFormat(globalOptions);
			const formatter = getFormatter(format);

			const basePath = join(homedir(), '.config', 'geniigotchi');

			// Check which files exist
			const files: Array<{ name: string; file: string; path: string; exists: boolean }> = [];

			for (const configFile of CONFIG_FILES) {
				const filePath = join(basePath, configFile.file);
				const exists = await fileExists(filePath);
				files.push({
					name: configFile.name,
					file: configFile.file,
					path: filePath,
					exists,
				});
			}

			if (format === 'json') {
				formatter.success({
					directory: basePath,
					files: files.map((f) => ({
						name: f.name,
						path: f.path,
						exists: f.exists,
					})),
				});
			} else if (format === 'quiet') {
				// In quiet mode, just output the directory path
				console.log(basePath);
			} else {
				console.log(`${chalk.bold('Configuration Directory:')}`);
				console.log(`  ${basePath}`);
				console.log('');
				console.log(`${chalk.bold('Configuration Files:')}`);

				for (const file of files) {
					const statusIcon = file.exists ? chalk.green('\u2713') : chalk.gray('\u25CB');
					const statusText = file.exists ? '' : chalk.gray(' (not found)');
					console.log(`  ${statusIcon} ${file.file}${statusText}`);
					console.log(`    ${chalk.gray(file.path)}`);
				}
			}
		});
}
