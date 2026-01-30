/**
 * Output format dispatch - selects and delegates to appropriate formatter.
 * @module output/formatter
 */

import { HumanFormatter } from './human';
import { JsonFormatter } from './json';
import { QuietFormatter } from './quiet';

/**
 * Available output formats.
 */
export type OutputFormat = 'human' | 'json' | 'quiet';

/**
 * Column definition for table output.
 */
export interface ColumnDef {
	/** Column header text */
	header: string;
	/** Key to access the value from data objects */
	key: string;
	/** Optional width (in characters) */
	width?: number;
	/** Optional alignment */
	align?: 'left' | 'right' | 'center';
	/** Optional transform function for the value */
	transform?: (value: unknown, row: unknown) => string;
}

/**
 * Common output data structure (legacy).
 */
export interface OutputData {
	/** The type of data being output */
	type: string;
	/** The actual data payload */
	data: unknown;
	/** Optional metadata */
	meta?: Record<string, unknown>;
}

/**
 * Formatter interface for consistent output across formats.
 */
export interface Formatter {
	/** Output successful data */
	success<T>(data: T): void;

	/** Output error message */
	error(error: Error | string): void;

	/** Output data as a table */
	table<T>(data: T[], columns: ColumnDef[]): void;

	/** Output data as a list */
	list<T>(data: T[], transform: (item: T) => string): void;

	/** Output key-value pairs */
	keyValue(pairs: Array<[string, unknown]>): void;

	/** Output a simple message */
	message(text: string, type?: 'info' | 'success' | 'warning' | 'error'): void;

	/** Output raw value (for scripting) */
	raw(value: unknown): void;
}

/**
 * Get a formatter for the specified output format.
 */
export function getFormatter(format: OutputFormat): Formatter {
	switch (format) {
		case 'json':
			return new JsonFormatter();
		case 'quiet':
			return new QuietFormatter();
		default:
			return new HumanFormatter();
	}
}

/**
 * Get the output format from command options.
 */
export function getOutputFormat(options: { output?: string; quiet?: boolean }): OutputFormat {
	if (options.quiet) {
		return 'quiet';
	}
	if (options.output === 'json') {
		return 'json';
	}
	if (options.output === 'quiet') {
		return 'quiet';
	}
	return 'human';
}

// =============================================================================
// Legacy Functions (for backwards compatibility)
// =============================================================================

/**
 * Format data for human-readable output.
 * @deprecated Use getFormatter('human') instead
 */
export function formatHuman(data: OutputData): string {
	const formatter = new HumanFormatter();
	return formatter.formatLegacy(data);
}

/**
 * Format data as JSON with envelope.
 * @deprecated Use getFormatter('json') instead
 */
export function formatJson(data: OutputData): string {
	const formatter = new JsonFormatter();
	return formatter.formatLegacy(data);
}

/**
 * Format data for quiet/minimal output.
 * @deprecated Use getFormatter('quiet') instead
 */
export function formatQuiet(data: OutputData): string {
	const formatter = new QuietFormatter();
	return formatter.formatLegacy(data);
}

/**
 * Format and output data according to the selected format.
 * @deprecated Use getFormatter(format).success(data) instead
 */
export function format(data: OutputData, outputFormat: OutputFormat = 'human'): string {
	switch (outputFormat) {
		case 'json':
			return formatJson(data);
		case 'quiet':
			return formatQuiet(data);
		default:
			return formatHuman(data);
	}
}

/**
 * Output formatted data to stdout.
 * @deprecated Use getFormatter(format).success(data) instead
 */
export function output(data: OutputData, outputFormat: OutputFormat = 'human'): void {
	const formatted = format(data, outputFormat);
	if (formatted) {
		console.log(formatted);
	}
}
