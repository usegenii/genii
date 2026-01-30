/**
 * Quiet/minimal output formatter.
 * @module output/quiet
 *
 * Only outputs essential information suitable for scripting.
 * - Success outputs nothing or just IDs
 * - Errors go to stderr
 * - Exit codes indicate success (0) or failure (1)
 */

import type { ColumnDef, Formatter, OutputData } from './formatter';

/**
 * Quiet formatter that outputs minimal information.
 * Designed for use in shell scripts and automation.
 */
export class QuietFormatter implements Formatter {
	success<T>(data: T): void {
		// In quiet mode, success outputs nothing unless it's an ID
		if (data === null || data === undefined) {
			return;
		}

		// If data has an id property, output just the id
		if (typeof data === 'object' && data !== null && 'id' in data) {
			console.log(String((data as Record<string, unknown>).id));
			return;
		}

		// If data is a string that looks like an ID, output it
		if (typeof data === 'string' && data.length > 0 && data.length < 100) {
			console.log(data);
		}
	}

	error(error: Error | string): void {
		// Errors always go to stderr in quiet mode
		const message = error instanceof Error ? error.message : error;
		console.error(message);
	}

	table<T>(data: T[], columns: ColumnDef[]): void {
		// In quiet mode, output only the first column (usually ID)
		if (data.length === 0) {
			return;
		}

		const firstColumn = columns[0];
		if (!firstColumn) {
			return;
		}

		for (const row of data) {
			const value = getValue(row, firstColumn.key);
			if (value !== null && value !== undefined) {
				console.log(String(value));
			}
		}
	}

	list<T>(data: T[], transform: (item: T) => string): void {
		// In quiet mode, output transformed values one per line
		for (const item of data) {
			const value = transform(item);
			if (value) {
				console.log(value);
			}
		}
	}

	keyValue(pairs: Array<[string, unknown]>): void {
		// In quiet mode, output only values (not keys)
		for (const [, value] of pairs) {
			if (value !== null && value !== undefined) {
				console.log(String(value));
			}
		}
	}

	message(_text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
		// In quiet mode, only errors produce output (to stderr)
		if (type === 'error') {
			console.error(_text);
		}
		// All other messages are suppressed
	}

	raw(value: unknown): void {
		if (value === null || value === undefined) {
			return;
		}
		console.log(String(value));
	}

	/**
	 * Format legacy OutputData structure.
	 */
	formatLegacy(data: OutputData): string {
		const { type, data: payload } = data;

		switch (type) {
			case 'agents':
				return formatIds(payload as unknown[]);
			case 'agent':
				return formatId(payload);
			case 'channels':
				return formatIds(payload as unknown[]);
			case 'conversations':
				return formatIds(payload as unknown[]);
			case 'status':
				return formatStatusQuiet(payload);
			case 'error':
				return formatErrorQuiet(payload);
			case 'success':
				return ''; // No output on success in quiet mode
			default:
				return '';
		}
	}
}

/**
 * Get value from an object by key path.
 */
function getValue(obj: unknown, key: string): unknown {
	if (typeof obj !== 'object' || obj === null) {
		return undefined;
	}

	const parts = key.split('.');
	let current: unknown = obj;

	for (const part of parts) {
		if (typeof current !== 'object' || current === null) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}

	return current;
}

/**
 * Format a list of items as IDs only (one per line).
 */
function formatIds(items: unknown[]): string {
	return items
		.map((item) => {
			if (typeof item === 'object' && item !== null && 'id' in item) {
				return String((item as { id: unknown }).id);
			}
			// Try ref for conversations
			if (typeof item === 'object' && item !== null && 'ref' in item) {
				return String((item as { ref: unknown }).ref);
			}
			return '';
		})
		.filter(Boolean)
		.join('\n');
}

/**
 * Format a single item as ID.
 */
function formatId(item: unknown): string {
	if (typeof item === 'object' && item !== null && 'id' in item) {
		return String((item as { id: unknown }).id);
	}
	if (typeof item === 'object' && item !== null && 'ref' in item) {
		return String((item as { ref: unknown }).ref);
	}
	return '';
}

/**
 * Format status in quiet mode (running/stopped).
 */
function formatStatusQuiet(status: unknown): string {
	if (typeof status === 'object' && status !== null) {
		// If it has a 'running' boolean field
		if ('running' in status) {
			return (status as { running: boolean }).running ? 'running' : 'stopped';
		}
		// If it has uptime, daemon is running
		if ('uptime' in status) {
			return 'running';
		}
	}
	return 'unknown';
}

/**
 * Format error in quiet mode (to stderr).
 */
function formatErrorQuiet(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	// In quiet mode, errors go to stderr
	console.error(message);
	return '';
}

// =============================================================================
// Legacy Exports (for backwards compatibility)
// =============================================================================

/**
 * Format data for quiet/minimal output.
 * @deprecated Use new QuietFormatter() instead
 */
export function formatQuiet(data: OutputData): string {
	const formatter = new QuietFormatter();
	return formatter.formatLegacy(data);
}
