import { describe, expect, it } from 'vitest';
import { formatDuration, formatRelativeTime, formatTimestamp, formatUptime, parseTimeString } from '../time';

describe('formatRelativeTime()', () => {
	const baseTime = 1700000000000; // Fixed reference time

	it('should return "just now" for times less than 1 second ago', () => {
		const result = formatRelativeTime(baseTime - 500, baseTime);
		expect(result).toBe('just now');
	});

	it('should return "in the future" for future times', () => {
		const result = formatRelativeTime(baseTime + 1000, baseTime);
		expect(result).toBe('in the future');
	});

	it('should format seconds ago', () => {
		const result = formatRelativeTime(baseTime - 30 * 1000, baseTime);
		expect(result).toBe('30s ago');
	});

	it('should format minutes ago', () => {
		const result = formatRelativeTime(baseTime - 5 * 60 * 1000, baseTime);
		expect(result).toBe('5m ago');
	});

	it('should format hours ago', () => {
		const result = formatRelativeTime(baseTime - 3 * 60 * 60 * 1000, baseTime);
		expect(result).toBe('3h ago');
	});

	it('should format days ago', () => {
		const result = formatRelativeTime(baseTime - 2 * 24 * 60 * 60 * 1000, baseTime);
		expect(result).toBe('2d ago');
	});

	it('should format months ago', () => {
		const result = formatRelativeTime(baseTime - 45 * 24 * 60 * 60 * 1000, baseTime);
		expect(result).toBe('1mo ago');
	});

	it('should format years ago', () => {
		const result = formatRelativeTime(baseTime - 400 * 24 * 60 * 60 * 1000, baseTime);
		expect(result).toBe('1y ago');
	});

	it('should accept Date objects', () => {
		const date = new Date(baseTime - 60 * 1000);
		const result = formatRelativeTime(date, baseTime);
		expect(result).toBe('1m ago');
	});

	it('should use current time as default for now parameter', () => {
		const recentTime = Date.now() - 5000; // 5 seconds ago
		const result = formatRelativeTime(recentTime);
		expect(result).toBe('5s ago');
	});
});

describe('formatDuration()', () => {
	it('should format milliseconds', () => {
		const result = formatDuration(500);
		expect(result).toBe('500ms');
	});

	it('should format seconds', () => {
		const result = formatDuration(5 * 1000);
		expect(result).toBe('5s');
	});

	it('should format minutes and seconds', () => {
		const result = formatDuration(2 * 60 * 1000 + 30 * 1000);
		expect(result).toBe('2m 30s');
	});

	it('should format hours and minutes', () => {
		const result = formatDuration(3 * 60 * 60 * 1000 + 15 * 60 * 1000);
		expect(result).toBe('3h 15m');
	});

	it('should format days and hours', () => {
		const result = formatDuration(2 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000);
		expect(result).toBe('2d 5h');
	});

	it('should limit to 2 significant units', () => {
		const result = formatDuration(2 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000 + 30 * 60 * 1000);
		expect(result).toBe('2d 5h');
	});

	it('should return "0s" for zero duration', () => {
		const result = formatDuration(0);
		expect(result).toBe('0ms');
	});
});

describe('formatUptime()', () => {
	it('should convert seconds to milliseconds and format', () => {
		const result = formatUptime(90);
		expect(result).toBe('1m 30s');
	});

	it('should handle zero', () => {
		const result = formatUptime(0);
		expect(result).toBe('0ms');
	});

	it('should handle large values', () => {
		const result = formatUptime(3600 + 1800); // 1.5 hours
		expect(result).toBe('1h 30m');
	});
});

describe('parseTimeString()', () => {
	it('should parse seconds', () => {
		const result = parseTimeString('30s');
		expect(result).toBe(30 * 1000);
	});

	it('should parse minutes', () => {
		const result = parseTimeString('5m');
		expect(result).toBe(5 * 60 * 1000);
	});

	it('should parse hours', () => {
		const result = parseTimeString('2h');
		expect(result).toBe(2 * 60 * 60 * 1000);
	});

	it('should parse days', () => {
		const result = parseTimeString('1d');
		expect(result).toBe(24 * 60 * 60 * 1000);
	});

	it('should parse months', () => {
		const result = parseTimeString('1mo');
		expect(result).toBe(30 * 24 * 60 * 60 * 1000);
	});

	it('should parse years', () => {
		const result = parseTimeString('1y');
		expect(result).toBe(365 * 24 * 60 * 60 * 1000);
	});

	it('should parse milliseconds', () => {
		const result = parseTimeString('500ms');
		expect(result).toBe(500);
	});

	it('should parse decimal values', () => {
		const result = parseTimeString('1.5h');
		expect(result).toBe(1.5 * 60 * 60 * 1000);
	});

	it('should default to seconds if no unit specified', () => {
		const result = parseTimeString('30');
		expect(result).toBe(30 * 1000);
	});

	it('should return null for invalid input', () => {
		const result = parseTimeString('invalid');
		expect(result).toBeNull();
	});

	it('should return null for empty string', () => {
		const result = parseTimeString('');
		expect(result).toBeNull();
	});

	it('should handle case insensitivity', () => {
		const result = parseTimeString('5M');
		expect(result).toBe(5 * 60 * 1000);
	});
});

describe('formatTimestamp()', () => {
	it('should format Date object to ISO-like string', () => {
		const date = new Date('2023-11-15T10:30:45.123Z');
		const result = formatTimestamp(date);
		expect(result).toBe('2023-11-15 10:30:45');
	});

	it('should format timestamp number to ISO-like string', () => {
		const timestamp = new Date('2023-11-15T10:30:45.123Z').getTime();
		const result = formatTimestamp(timestamp);
		expect(result).toBe('2023-11-15 10:30:45');
	});

	it('should remove milliseconds and T separator', () => {
		const date = new Date('2023-01-01T00:00:00.999Z');
		const result = formatTimestamp(date);
		expect(result).toBe('2023-01-01 00:00:00');
		expect(result).not.toContain('T');
		expect(result).not.toContain('.');
	});
});
