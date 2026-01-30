/**
 * Time formatting utilities for the CLI.
 * @module utils/time
 */

/**
 * Time unit definitions in milliseconds.
 */
const TIME_UNITS: Array<{ unit: string; ms: number }> = [
	{ unit: 'y', ms: 365 * 24 * 60 * 60 * 1000 },
	{ unit: 'mo', ms: 30 * 24 * 60 * 60 * 1000 },
	{ unit: 'd', ms: 24 * 60 * 60 * 1000 },
	{ unit: 'h', ms: 60 * 60 * 1000 },
	{ unit: 'm', ms: 60 * 1000 },
	{ unit: 's', ms: 1000 },
];

/**
 * Format a date as relative time (e.g., "2m ago", "1h ago").
 * @param date - The date to format
 * @param now - The current time (defaults to Date.now())
 * @returns Formatted relative time string
 */
export function formatRelativeTime(date: Date | number, now: number = Date.now()): string {
	const timestamp = typeof date === 'number' ? date : date.getTime();
	const diff = now - timestamp;

	if (diff < 0) {
		return 'in the future';
	}

	if (diff < 1000) {
		return 'just now';
	}

	for (const { unit, ms } of TIME_UNITS) {
		if (diff >= ms) {
			const value = Math.floor(diff / ms);
			return `${value}${unit} ago`;
		}
	}

	return 'just now';
}

/**
 * Format duration in a human-readable way.
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}

	const parts: string[] = [];
	let remaining = ms;

	for (const { unit, ms: unitMs } of TIME_UNITS) {
		if (remaining >= unitMs) {
			const value = Math.floor(remaining / unitMs);
			parts.push(`${value}${unit}`);
			remaining = remaining % unitMs;
		}

		// Stop after 2 significant units
		if (parts.length >= 2) {
			break;
		}
	}

	return parts.join(' ') || '0s';
}

/**
 * Format uptime in a human-readable way.
 * @param seconds - Uptime in seconds
 * @returns Formatted uptime string
 */
export function formatUptime(seconds: number): string {
	return formatDuration(seconds * 1000);
}

/**
 * Parse a time string (e.g., "1h", "30m", "1d") to milliseconds.
 * @param timeStr - The time string to parse
 * @returns Duration in milliseconds, or null if invalid
 */
export function parseTimeString(timeStr: string): number | null {
	const match = timeStr.match(/^(\d+(?:\.\d+)?)(y|mo|d|h|m|s|ms)?$/i);
	if (!match) {
		return null;
	}

	const value = parseFloat(match[1] ?? '0');
	const unit = (match[2] ?? 's').toLowerCase();

	const unitMs: Record<string, number> = {
		y: 365 * 24 * 60 * 60 * 1000,
		mo: 30 * 24 * 60 * 60 * 1000,
		d: 24 * 60 * 60 * 1000,
		h: 60 * 60 * 1000,
		m: 60 * 1000,
		s: 1000,
		ms: 1,
	};

	const multiplier = unitMs[unit];
	if (multiplier === undefined) {
		return null;
	}

	return Math.round(value * multiplier);
}

/**
 * Format a timestamp for display.
 * @param date - The date to format
 * @returns Formatted timestamp string
 */
export function formatTimestamp(date: Date | number): string {
	const d = typeof date === 'number' ? new Date(date) : date;
	return d.toISOString().replace('T', ' ').substring(0, 19);
}
