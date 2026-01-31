import { homedir } from 'node:os';
import { Type } from '@sinclair/typebox';
import type { Tool } from '../types.js';
import { MAX_TIMEOUT_MS, TRUNCATION_INDICATOR } from './constants.js';
import { executeShellCommand } from './executor.js';
import { truncateOutput } from './truncate.js';

/**
 * Configuration for the shell tool.
 */
export interface ShellToolConfig {
	/** Default working directory (falls back to os.homedir() if not set) */
	defaultWorkingDir?: string;
	/** Default timeout in milliseconds */
	defaultTimeout: number;
	/** Maximum output length in characters */
	maxOutputLength: number;
}

/**
 * Input schema for the shell tool.
 */
const ShellToolInputSchema = Type.Object({
	command: Type.String({ description: 'The shell command to execute' }),
	workingDirectory: Type.Optional(Type.String({ description: 'Working directory (overrides default)' })),
	timeout: Type.Optional(
		Type.Number({
			description: 'Timeout in ms (default from config, max 300000)',
			minimum: 1000,
		}),
	),
});

/**
 * Input type for the shell tool.
 */
type ShellToolInput = {
	command: string;
	workingDirectory?: string;
	timeout?: number;
};

/**
 * Create a shell tool with the given configuration.
 *
 * The tool executes shell commands and returns output in XML format:
 * - `<stdout>` - Standard output (omitted if empty)
 * - `<stderr>` - Standard error (omitted if empty)
 * - `<exit-code>` - Exit code (124 for timeout)
 * - `<timed-out>` - Present if command timed out
 *
 * Resolution order for settings:
 * - Working directory: input → config → os.homedir()
 * - Timeout: input → config, clamped to MAX_TIMEOUT_MS
 * - Shell: $SHELL → /bin/sh
 *
 * @param config - Tool configuration
 * @returns Shell tool instance
 */
export function createShellTool(config: ShellToolConfig): Tool<ShellToolInput, string> {
	const description = `Execute a shell command on the host system and return the output.

WARNING: This tool has full access to the user's computer and file system. Commands run with the same permissions as the parent process.

Exercise extreme caution with:
- Destructive commands (rm, rmdir, format, etc.)
- File modifications that cannot be undone
- System configuration changes
- Commands that affect network or security settings
- Package installations or uninstallations

Best practices:
- Prefer read-only operations when possible
- Double-check paths before deletion or modification
- Use --dry-run flags when available
- Consider the irreversibility of actions before executing`;

	return {
		name: 'shell',
		label: 'Shell',
		description,
		category: 'system',
		parameters: ShellToolInputSchema,

		execute: async (input, context) => {
			const shell = process.env.SHELL || '/bin/sh';
			const workingDir = input.workingDirectory ?? config.defaultWorkingDir ?? homedir();
			const timeout = Math.min(input.timeout ?? config.defaultTimeout, MAX_TIMEOUT_MS);

			context.log('info', `Executing: ${input.command}`);

			const result = await executeShellCommand({
				command: input.command,
				workingDirectory: workingDir,
				timeout,
				signal: context.signal,
				shell,
			});

			// Truncate outputs
			const stdoutResult = truncateOutput(result.stdout, config.maxOutputLength);
			const stderrResult = truncateOutput(result.stderr, config.maxOutputLength);

			// Format output with XML tags, omitting empty sections
			let output = '';

			if (stdoutResult.text) {
				const prefix = stdoutResult.truncated ? TRUNCATION_INDICATOR : '';
				output += `<stdout>\n${prefix}${stdoutResult.text}</stdout>\n`;
			}

			if (stderrResult.text) {
				const prefix = stderrResult.truncated ? TRUNCATION_INDICATOR : '';
				output += `<stderr>\n${prefix}${stderrResult.text}</stderr>\n`;
			}

			output += `<exit-code>${result.exitCode}</exit-code>`;

			if (result.timedOut) {
				output += '\n<timed-out>true</timed-out>';
			}

			return {
				status: 'success',
				output,
			};
		},
	};
}
