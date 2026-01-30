/**
 * JSON output formatter with envelope structure.
 * @module output/json
 */

import type { ColumnDef, Formatter, OutputData } from './formatter';

/**
 * JSON output envelope structure.
 */
export interface JsonEnvelope<T = unknown> {
	/** Whether the operation was successful */
	ok: boolean;
	/** The actual data payload */
	data?: T;
	/** Error information if not successful */
	error?: {
		message: string;
		code?: string;
	};
	/** Timestamp of the response */
	timestamp: string;
}

/**
 * JSON formatter that wraps all output in an envelope.
 */
export class JsonFormatter implements Formatter {
	success<T>(data: T): void {
		const envelope: JsonEnvelope<T> = {
			ok: true,
			data,
			timestamp: new Date().toISOString(),
		};
		console.log(JSON.stringify(envelope, null, 2));
	}

	error(error: Error | string): void {
		const message = error instanceof Error ? error.message : error;
		const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;

		const envelope: JsonEnvelope = {
			ok: false,
			error: {
				message,
				...(code && { code }),
			},
			timestamp: new Date().toISOString(),
		};
		console.log(JSON.stringify(envelope, null, 2));
	}

	table<T>(data: T[], columns: ColumnDef[]): void {
		// Transform data based on column definitions
		const transformed = data.map((row) => {
			const result: Record<string, unknown> = {};
			for (const col of columns) {
				const value = getValue(row, col.key);
				result[col.key] = col.transform ? col.transform(value, row) : value;
			}
			return result;
		});

		const envelope: JsonEnvelope<typeof transformed> = {
			ok: true,
			data: transformed,
			timestamp: new Date().toISOString(),
		};
		console.log(JSON.stringify(envelope, null, 2));
	}

	list<T>(data: T[], transform: (item: T) => string): void {
		const transformed = data.map(transform);

		const envelope: JsonEnvelope<string[]> = {
			ok: true,
			data: transformed,
			timestamp: new Date().toISOString(),
		};
		console.log(JSON.stringify(envelope, null, 2));
	}

	keyValue(pairs: Array<[string, unknown]>): void {
		const data = Object.fromEntries(pairs);

		const envelope: JsonEnvelope<typeof data> = {
			ok: true,
			data,
			timestamp: new Date().toISOString(),
		};
		console.log(JSON.stringify(envelope, null, 2));
	}

	message(text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
		if (type === 'error') {
			const envelope: JsonEnvelope = {
				ok: false,
				error: { message: text },
				timestamp: new Date().toISOString(),
			};
			console.log(JSON.stringify(envelope, null, 2));
		} else {
			const envelope: JsonEnvelope<{ message: string; type: string }> = {
				ok: true,
				data: { message: text, type },
				timestamp: new Date().toISOString(),
			};
			console.log(JSON.stringify(envelope, null, 2));
		}
	}

	raw(value: unknown): void {
		const envelope: JsonEnvelope = {
			ok: true,
			data: value,
			timestamp: new Date().toISOString(),
		};
		console.log(JSON.stringify(envelope, null, 2));
	}

	/**
	 * Format legacy OutputData structure.
	 */
	formatLegacy(data: OutputData): string {
		const envelope: JsonEnvelope & { type: string; meta?: Record<string, unknown> } = {
			ok: data.type !== 'error',
			type: data.type,
			data: data.type === 'error' ? null : data.data,
			timestamp: new Date().toISOString(),
		};

		if (data.meta) {
			envelope.meta = data.meta;
		}

		if (data.type === 'error') {
			const errorData = data.data;
			envelope.error = {
				message: errorData instanceof Error ? errorData.message : String(errorData),
				code: errorData instanceof Error && 'code' in errorData ? String(errorData.code) : undefined,
			};
		}

		return JSON.stringify(envelope, null, 2);
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

// =============================================================================
// Legacy Exports (for backwards compatibility)
// =============================================================================

/**
 * Legacy JsonEnvelope type alias.
 * @deprecated Use JsonEnvelope<T> instead
 */
export type LegacyJsonEnvelope = {
	success: boolean;
	type: string;
	data: unknown;
	meta?: Record<string, unknown>;
	error?: {
		message: string;
		code?: string;
	};
	timestamp: string;
};

/**
 * Format data as JSON with envelope.
 * @deprecated Use new JsonFormatter().success(data) instead
 */
export function formatJson(data: OutputData): string {
	const formatter = new JsonFormatter();
	return formatter.formatLegacy(data);
}

/**
 * Format data as compact JSON (single line).
 * @deprecated Use JSON.stringify directly
 */
export function formatJsonCompact(data: OutputData): string {
	const envelope = {
		ok: data.type !== 'error',
		type: data.type,
		data: data.type === 'error' ? null : data.data,
		timestamp: new Date().toISOString(),
		...(data.meta && { meta: data.meta }),
	};

	return JSON.stringify(envelope);
}
