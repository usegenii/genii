/**
 * Onboard command for copying template guidance files.
 *
 * This command triggers the daemon to copy template guidance files
 * (SOUL.md, INSTRUCTIONS.md) to the guidance directory.
 *
 * @module commands/onboard
 */

import * as readline from 'node:readline';
import { getProvider } from '@geniigotchi/config/providers/definitions';
import { createSecretStore } from '@geniigotchi/config/secrets/composite';
import type { ModelConfigWrite } from '@geniigotchi/config/writers/models';
import { saveModelsConfig } from '@geniigotchi/config/writers/models';
import { savePreferencesConfig } from '@geniigotchi/config/writers/preferences';
import { saveProvidersConfig } from '@geniigotchi/config/writers/providers';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { createDaemonClient } from '../client';
import { getFormatter, getOutputFormat } from '../output/formatter';
import { OnboardingWizard } from '../tui/onboarding/wizard';

/**
 * Convert interval shorthand to cron expression.
 */
function intervalToCron(interval: string): string {
	switch (interval) {
		case '15m':
			return '*/15 * * * *';
		case '30m':
			return '*/30 * * * *';
		case '1h':
			return '0 * * * *';
		case '2h':
			return '0 */2 * * *';
		case '4h':
			return '0 */4 * * *';
		case '6h':
			return '0 */6 * * *';
		default:
			return '0 * * * *';
	}
}

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
		.option('-n, --non-interactive', 'Skip TUI wizard and use CLI flags')
		.option('--accept-disclaimer', 'Accept disclaimer (required for non-interactive)')
		.option('--provider <id>', 'Provider ID (e.g., "zai")')
		.option('--api-key <key>', 'API key for provider')
		.option('--models <list>', 'Comma-separated model IDs')
		.option('--log-level <level>', 'Log level (debug, info, warn, error)')
		.option('--enable-pulse', 'Enable Pulse feature')
		.option('--pulse-interval <interval>', 'Pulse interval (15m, 30m, 1h, 2h, 4h, 6h)')
		.option('--templates <mode>', 'Template conflict mode (backup, skip, overwrite)')
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

				if (options.nonInteractive) {
					// Non-interactive mode
					if (!options.acceptDisclaimer) {
						formatter.error(new Error('--accept-disclaimer is required for non-interactive mode'));
						process.exit(1);
					}

					// Validate required flags
					if (!options.provider) {
						formatter.error(new Error('--provider is required for non-interactive mode'));
						process.exit(1);
					}
					if (!options.apiKey) {
						formatter.error(new Error('--api-key is required for non-interactive mode'));
						process.exit(1);
					}
					if (!options.models) {
						formatter.error(new Error('--models is required for non-interactive mode'));
						process.exit(1);
					}

					// Derive config path from guidance path (remove /guidance suffix)
					const configPath = status.guidancePath.replace(/\/guidance$/, '');

					// Get provider definition
					const providerDef = getProvider(options.provider);
					if (!providerDef) {
						formatter.error(new Error(`Unknown provider: ${options.provider}`));
						process.exit(1);
					}

					if (!providerDef.defaultBaseUrl) {
						formatter.error(new Error(`Provider ${options.provider} has no default base URL`));
						process.exit(1);
					}

					// Store API key in secret store
					const secretStore = await createSecretStore(configPath, 'geniigotchi');
					const secretName = `${options.provider}-api-key`;
					const secretResult = await secretStore.set(secretName, options.apiKey);
					if (!secretResult.success) {
						formatter.error(new Error(`Failed to store API key: ${secretResult.error}`));
						process.exit(1);
					}
					formatter.message('API key stored securely', 'success');

					// Write provider config
					await saveProvidersConfig(configPath, {
						[options.provider]: {
							type: providerDef.apiType,
							baseUrl: providerDef.defaultBaseUrl,
							credential: `secret:${secretName}`,
						},
					});
					formatter.message(`Provider ${options.provider} configured`, 'success');

					// Write models config
					const modelIds = (options.models as string).split(',').map((s: string) => s.trim());
					const modelsConfig: Record<string, ModelConfigWrite> = {};
					for (const modelId of modelIds) {
						modelsConfig[modelId] = {
							provider: options.provider,
							modelId,
						};
					}
					await saveModelsConfig(configPath, modelsConfig);
					formatter.message(`Models configured: ${modelIds.join(', ')}`, 'success');

					// Write preferences config
					const preferencesConfig: {
						logLevel?: 'debug' | 'info' | 'warn' | 'error';
						shellTimeout?: number;
					} = {
						logLevel: (options.logLevel as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
						shellTimeout: 30,
					};
					await savePreferencesConfig(configPath, preferencesConfig);
					formatter.message('Preferences configured', 'success');

					// Handle Pulse config if enabled
					if (options.enablePulse) {
						const pulseInterval = (options.pulseInterval as string) ?? '1h';
						const pulseSchedule = intervalToCron(pulseInterval);

						// Write scheduler config with pulse enabled
						// Since the preferences writer supports merging, we write directly to the file
						const { writeTomlFile } = await import('@geniigotchi/config/writers/toml');
						const { readTomlFileOptional } = await import('@geniigotchi/config/loaders/toml');
						const { join } = await import('node:path');

						const prefsPath = join(configPath, 'preferences.toml');
						const existingPrefs = await readTomlFileOptional<Record<string, unknown>>(prefsPath);

						const schedulerConfig = {
							...existingPrefs,
							scheduler: {
								enabled: true,
								pulse: {
									schedule: pulseSchedule,
								},
							},
						};

						await writeTomlFile(prefsPath, schedulerConfig);
						formatter.message(`Pulse enabled with schedule: ${pulseSchedule}`, 'success');
					}

					// Display what will be copied
					formatter.message(`Guidance directory: ${status.guidancePath}`, 'info');
					formatter.message(`Templates to copy: ${status.templates.join(', ')}`, 'info');

					if (options.dryRun) {
						formatter.message('Dry run - no files will be copied', 'info');

						if (status.existing.length > 0) {
							formatter.message(
								`Files that would be overwritten: ${status.existing.join(', ')}`,
								'warning',
							);
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
				} else {
					// Interactive TUI mode (default)
					const { waitUntilExit } = render(
						React.createElement(OnboardingWizard, {
							configPath: status.guidancePath,
							onComplete: () => formatter.success({ message: 'Setup complete' }),
							onCancel: () => formatter.message('Setup cancelled', 'info'),
						}),
					);
					await waitUntilExit();
				}
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
