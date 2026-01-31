/**
 * Tests for datetime formatting utilities.
 */

import { describe, expect, it } from 'vitest';
import { formatDateTime } from './format';

describe('formatDateTime', () => {
	// Use a fixed date for consistent testing
	// January 31, 2026 at 23:45:00 UTC
	const testDate = new Date('2026-01-31T23:45:00Z');

	describe('format pattern', () => {
		it('should format date with expected pattern: Day Mon DD, YYYY H:MM AM/PM TZ', () => {
			const result = formatDateTime(testDate, 'UTC');
			// Should match pattern like "Sat Jan 31, 2026 11:45 PM UTC"
			expect(result).toMatch(/^\w{3} \w{3} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM) \w+$/);
		});

		it('should include weekday abbreviation', () => {
			const result = formatDateTime(testDate, 'UTC');
			expect(result).toMatch(/^Sat/);
		});

		it('should include month abbreviation', () => {
			const result = formatDateTime(testDate, 'UTC');
			expect(result).toContain(' Jan ');
		});

		it('should include year', () => {
			const result = formatDateTime(testDate, 'UTC');
			expect(result).toContain('2026');
		});

		it('should include timezone abbreviation', () => {
			const result = formatDateTime(testDate, 'UTC');
			expect(result).toMatch(/UTC$/);
		});
	});

	describe('timezone formatting', () => {
		it('should format UTC timezone', () => {
			const result = formatDateTime(testDate, 'UTC');
			// 23:45 UTC = 11:45 PM UTC
			expect(result).toBe('Sat Jan 31, 2026 11:45 PM UTC');
		});

		it('should format America/New_York timezone (EST)', () => {
			const result = formatDateTime(testDate, 'America/New_York');
			// 23:45 UTC = 18:45 EST (UTC-5 in January)
			expect(result).toMatch(/Sat Jan 31, 2026 6:45 PM (EST|ET)/);
		});

		it('should format America/Los_Angeles timezone (PST)', () => {
			const result = formatDateTime(testDate, 'America/Los_Angeles');
			// 23:45 UTC = 15:45 PST (UTC-8 in January)
			expect(result).toMatch(/Sat Jan 31, 2026 3:45 PM (PST|PT)/);
		});

		it('should format Europe/London timezone', () => {
			const result = formatDateTime(testDate, 'Europe/London');
			// 23:45 UTC = 23:45 GMT (no DST in January)
			expect(result).toMatch(/Sat Jan 31, 2026 11:45 PM (GMT|UTC)/);
		});

		it('should format Asia/Tokyo timezone (JST)', () => {
			// Tokyo is UTC+9, so 23:45 UTC = 08:45 next day JST
			const result = formatDateTime(testDate, 'Asia/Tokyo');
			expect(result).toMatch(/Sun Feb 1, 2026 8:45 AM (JST|GMT\+9)/);
		});

		it('should format Australia/Sydney timezone', () => {
			// Sydney is UTC+11 in January (summer time), so 23:45 UTC = 10:45 next day AEDT
			const result = formatDateTime(testDate, 'Australia/Sydney');
			expect(result).toMatch(/Sun Feb 1, 2026 10:45 AM (AEDT|GMT\+11)/);
		});

		it('should format Europe/Paris timezone (CET)', () => {
			// Paris is UTC+1 in January, so 23:45 UTC = 00:45 next day CET
			const result = formatDateTime(testDate, 'Europe/Paris');
			expect(result).toMatch(/Sun Feb 1, 2026 12:45 AM (CET|GMT\+1)/);
		});
	});

	describe('edge cases - midnight', () => {
		it('should format midnight correctly in UTC', () => {
			const midnight = new Date('2026-01-31T00:00:00Z');
			const result = formatDateTime(midnight, 'UTC');
			expect(result).toBe('Sat Jan 31, 2026 12:00 AM UTC');
		});

		it('should format midnight correctly in local timezone', () => {
			// Midnight in New York = 05:00 UTC in January
			const midnightNY = new Date('2026-01-31T05:00:00Z');
			const result = formatDateTime(midnightNY, 'America/New_York');
			expect(result).toMatch(/Sat Jan 31, 2026 12:00 AM (EST|ET)/);
		});
	});

	describe('edge cases - noon', () => {
		it('should format noon correctly in UTC', () => {
			const noon = new Date('2026-01-31T12:00:00Z');
			const result = formatDateTime(noon, 'UTC');
			expect(result).toBe('Sat Jan 31, 2026 12:00 PM UTC');
		});

		it('should format noon correctly in local timezone', () => {
			// Noon in Los Angeles = 20:00 UTC in January
			const noonLA = new Date('2026-01-31T20:00:00Z');
			const result = formatDateTime(noonLA, 'America/Los_Angeles');
			expect(result).toMatch(/Sat Jan 31, 2026 12:00 PM (PST|PT)/);
		});
	});

	describe('edge cases - single digit hours', () => {
		it('should format single digit hours without leading zero', () => {
			// 01:30 UTC
			const earlyMorning = new Date('2026-01-31T01:30:00Z');
			const result = formatDateTime(earlyMorning, 'UTC');
			expect(result).toBe('Sat Jan 31, 2026 1:30 AM UTC');
		});

		it('should format 9 AM correctly', () => {
			const nineAM = new Date('2026-01-31T09:00:00Z');
			const result = formatDateTime(nineAM, 'UTC');
			expect(result).toBe('Sat Jan 31, 2026 9:00 AM UTC');
		});
	});

	describe('date boundary crossing', () => {
		it('should handle date change when crossing timezone boundaries', () => {
			// 01:00 UTC on Feb 1 = 20:00 PST on Jan 31 (UTC-8)
			const afterMidnightUTC = new Date('2026-02-01T01:00:00Z');
			const result = formatDateTime(afterMidnightUTC, 'America/Los_Angeles');
			expect(result).toMatch(/Sat Jan 31, 2026 5:00 PM (PST|PT)/);
		});

		it('should handle month change correctly', () => {
			// End of month in UTC, next month in Asia/Tokyo
			const endOfJan = new Date('2026-01-31T20:00:00Z');
			const result = formatDateTime(endOfJan, 'Asia/Tokyo');
			// 20:00 UTC = 05:00 next day JST
			expect(result).toMatch(/Sun Feb 1, 2026 5:00 AM (JST|GMT\+9)/);
		});
	});

	describe('consistent formatting', () => {
		it('should produce consistent output for same inputs', () => {
			const date = new Date('2026-01-31T15:30:00Z');
			const result1 = formatDateTime(date, 'America/New_York');
			const result2 = formatDateTime(date, 'America/New_York');
			expect(result1).toBe(result2);
		});

		it('should produce different output for different timezones', () => {
			const date = new Date('2026-01-31T15:30:00Z');
			const utcResult = formatDateTime(date, 'UTC');
			const nyResult = formatDateTime(date, 'America/New_York');
			expect(utcResult).not.toBe(nyResult);
		});
	});
});
