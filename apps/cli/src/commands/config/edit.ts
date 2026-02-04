/**
 * Config edit command.
 * @module commands/config/edit
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Valid configuration section names.
 */
type ConfigSection = 'providers' | 'models' | 'channels' | 'preferences';

/**
 * Mapping of section names to file names.
 */
const SECTION_FILES: Record<ConfigSection, string> = {
	providers: 'providers.toml',
	models: 'models.toml',
	channels: 'channels.toml',
	preferences: 'preferences.toml',
};

/**
 * Check if a string is a valid config section.
 */
function isValidSection(section: string): section is ConfigSection {
	return section in SECTION_FILES;
}

/**
 * Get the default editor command for the current platform.
 */
function getDefaultEditor(): string {
	// Check environment variables first
	if (process.env.VISUAL) {
		return process.env.VISUAL;
	}
	if (process.env.EDITOR) {
		return process.env.EDITOR;
	}

	// Platform-specific defaults
	switch (process.platform) {
		case 'darwin':
			return 'open -t'; // Opens with default text editor on macOS
		case 'win32':
			return 'notepad';
		default:
			return 'nano'; // Common Linux default
	}
}

/**
 * Open a path in the editor.
 */
async function openInEditor(path: string, editor: string): Promise<void> {
	return new Promise((resolve, reject) => {
		// Split the editor command in case it has arguments (like "open -t")
		const parts = editor.split(/\s+/);
		const command = parts[0];
		const args = [...parts.slice(1), path];

		if (!command) {
			reject(new Error('No editor command specified'));
			return;
		}

		const child = spawn(command, args, {
			stdio: 'inherit',
			shell: true,
		});

		child.on('error', (error) => {
			reject(new Error(`Failed to open editor: ${error.message}`));
		});

		child.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Editor exited with code ${code}`));
			}
		});
	});
}

/**
 * Edit configuration file.
 */
export function editCommand(config: Command): void {
	config
		.command('edit [section]')
		.description('Open configuration file in editor')
		.action(async (section: string | undefined) => {
			const globalOptions = config.parent?.opts() ?? {};
			const format = getOutputFormat(globalOptions);
			const formatter = getFormatter(format);

			const basePath = join(homedir(), '.config', 'genii');

			// Validate section if provided
			if (section && !isValidSection(section)) {
				formatter.error(
					`Invalid section: ${section}. Valid sections: providers, models, channels, preferences`,
				);
				process.exit(1);
			}

			// Ensure the config directory exists
			try {
				await mkdir(basePath, { recursive: true });
			} catch (error) {
				if (error instanceof Error && 'code' in error && error.code !== 'EEXIST') {
					formatter.error(`Failed to create config directory: ${error.message}`);
					process.exit(1);
				}
			}

			// Determine what to open
			let pathToOpen: string;
			if (section) {
				pathToOpen = join(basePath, SECTION_FILES[section as ConfigSection]);
			} else {
				// Open the config directory if no section specified
				pathToOpen = basePath;
			}

			const editor = getDefaultEditor();

			try {
				await openInEditor(pathToOpen, editor);

				if (format !== 'quiet') {
					if (section) {
						formatter.message(`Opened ${section} configuration for editing`, 'success');
					} else {
						formatter.message('Opened configuration directory', 'success');
					}
				}
			} catch (error) {
				formatter.error(error instanceof Error ? error : new Error(String(error)));
				process.exit(1);
			}
		});
}
