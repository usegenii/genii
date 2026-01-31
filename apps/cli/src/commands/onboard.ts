/**
 * Onboard command for copying template guidance files.
 *
 * This command triggers the daemon to copy template guidance files
 * (SOUL.md, INSTRUCTIONS.md) to the guidance directory.
 *
 * @module commands/onboard
 */

import * as readline from 'node:readline';
import type { Command } from 'commander';
import { createDaemonClient } from '../client';
import { getFormatter, getOutputFormat } from '../output/formatter';

/**
 * Prompt the user for Y/N confirmation.
 */
async function confirm(message: string): Promise<boolean> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(`${message} [y/N] `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
		});
	});
}

/**
 * Register the onboard command as a top-level command.
 */
export function registerOnboardCommand(program: Command): void {
	program
		.command('onboard')
		.description('Copy template guidance files (SOUL.md, INSTRUCTIONS.md) to the guidance directory')
		.option('-f, --force', 'Overwrite existing files without prompting')
		.option('--dry-run', 'Show what would be copied without actually copying')
		.option('--no-backup', 'Do not create .bak files when overwriting')
		.action(async (options) => {
			const globalOptions = program.opts();
			const format = getOutputFormat(globalOptions);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				// Get onboard status
				const status = await client.onboardStatus();

				// Display what will be copied
				formatter.message(`Guidance directory: ${status.guidancePath}`, 'info');
				formatter.message(`Templates to copy: ${status.templates.join(', ')}`, 'info');

				if (options.dryRun) {
					formatter.message('Dry run - no files will be copied', 'info');

					if (status.existing.length > 0) {
						formatter.message(`Files that would be overwritten: ${status.existing.join(', ')}`, 'warning');
					}

					const result = await client.onboardExecute({
						backup: options.backup !== false,
						dryRun: true,
					});

					formatter.success({
						message: 'Dry run complete',
						wouldCopy: result.skipped,
					});
					return;
				}

				// Check if files would be overwritten
				if (status.existing.length > 0 && !options.force) {
					formatter.message(`The following files already exist and will be overwritten:`, 'warning');
					for (const file of status.existing) {
						formatter.message(`  - ${file}`, 'warning');
					}

					if (options.backup !== false) {
						formatter.message('Backup files (.bak) will be created.', 'info');
					} else {
						formatter.message('No backup files will be created (--no-backup specified).', 'warning');
					}

					const confirmed = await confirm('Do you want to continue?');
					if (!confirmed) {
						formatter.message('Onboarding cancelled.', 'info');
						return;
					}
				}

				// Execute onboard
				const result = await client.onboardExecute({
					backup: options.backup !== false,
					dryRun: false,
				});

				if (result.copied.length > 0) {
					formatter.message(`Copied: ${result.copied.join(', ')}`, 'success');
				}

				if (result.backedUp.length > 0) {
					formatter.message(`Backed up: ${result.backedUp.join(', ')}`, 'info');
				}

				formatter.success({ message: 'Onboarding complete', ...result });
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
