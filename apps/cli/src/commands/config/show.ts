/**
 * Config show command and command group registration.
 * @module commands/config/show
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { editCommand } from './edit';
import { pathCommand } from './path';
import { validateCommand } from './validate';

/**
 * Valid configuration section names.
 */
type ConfigSection = 'providers' | 'models' | 'channels' | 'preferences';

/**
 * Check if a string is a valid config section.
 */
function isValidSection(section: string): section is ConfigSection {
	return ['providers', 'models', 'channels', 'preferences'].includes(section);
}

/**
 * Recursively sanitize secrets in a configuration object.
 * Replaces any values that look like credentials with "***".
 */
function sanitizeSecrets(obj: unknown): unknown {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (typeof obj === 'string') {
		// Check if this looks like a secret reference
		if (obj.startsWith('secret:') || obj.startsWith('env:') || obj.startsWith('keychain:')) {
			return '***';
		}
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map(sanitizeSecrets);
	}

	if (typeof obj === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			// Sanitize values for keys that look like credentials
			const keyLower = key.toLowerCase();
			if (
				keyLower.includes('credential') ||
				keyLower.includes('secret') ||
				keyLower.includes('password') ||
				keyLower.includes('token') ||
				keyLower.includes('apikey') ||
				keyLower.includes('api_key')
			) {
				result[key] = '***';
			} else {
				result[key] = sanitizeSecrets(value);
			}
		}
		return result;
	}

	return obj;
}

/**
 * Show current configuration.
 */
export function showCommand(config: Command): void {
	config
		.command('show')
		.description('Show current configuration')
		.option('--section <section>', 'Show only a specific section (providers, models, channels, preferences)')
		.action(async (options) => {
			const globalOptions = config.parent?.opts() ?? {};
			const format = getOutputFormat(globalOptions);
			const formatter = getFormatter(format);

			// Validate section if provided
			if (options.section && !isValidSection(options.section)) {
				formatter.error(
					`Invalid section: ${options.section}. Valid sections: providers, models, channels, preferences`,
				);
				process.exit(1);
			}

			const client = createDaemonClient();

			try {
				await client.connect();

				const section = options.section as ConfigSection | undefined;
				const configData = await client.getConfig(section);

				// Sanitize secrets before displaying
				const sanitizedConfig = sanitizeSecrets(configData);

				formatter.success(sanitizedConfig);
			} catch (error) {
				// If daemon is not running, try to load config directly from files
				if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
					try {
						const { getDefaultBasePath } = await import('@genii/config/paths');
						const basePath = getDefaultBasePath();
						const section = options.section as ConfigSection | undefined;

						// Dynamically import the config module
						const { loadConfig } = await import('@genii/config/config');
						const loadedConfig = await loadConfig({ basePath });

						let configData: unknown;
						if (section) {
							switch (section) {
								case 'providers':
									configData = loadedConfig.getProviders();
									break;
								case 'models':
									configData = loadedConfig.getModels();
									break;
								case 'channels':
									configData = loadedConfig.getChannels();
									break;
								case 'preferences':
									configData = loadedConfig.getPreferences();
									break;
							}
						} else {
							configData = {
								providers: loadedConfig.getProviders(),
								models: loadedConfig.getModels(),
								channels: loadedConfig.getChannels(),
								preferences: loadedConfig.getPreferences(),
							};
						}

						const sanitizedConfig = sanitizeSecrets(configData);
						formatter.success(sanitizedConfig);
						return;
					} catch (loadError) {
						formatter.error(loadError instanceof Error ? loadError : new Error(String(loadError)));
						process.exit(1);
					}
				}

				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}

/**
 * Register all config-related commands under the 'config' command group.
 */
export function registerConfigCommands(program: Command): void {
	const config = program.command('config').alias('cfg').description('Manage configuration');

	showCommand(config);
	validateCommand(config);
	pathCommand(config);
	editCommand(config);
}
