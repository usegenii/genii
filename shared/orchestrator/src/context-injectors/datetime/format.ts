/**
 * Date formatting utilities for the datetime context injector.
 */

/**
 * Format a date with timezone into a human-readable string.
 * Format: `Fri Jan 31, 2026 3:45 PM PST`
 *
 * @param date - The date to format
 * @param timezone - The timezone to use (e.g., 'America/New_York', 'America/Los_Angeles')
 * @returns Formatted date string
 */
export function formatDateTime(date: Date, timezone: string): string {
	const formatter = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
		timeZone: timezone,
		timeZoneName: 'short',
	});

	const parts = formatter.formatToParts(date);
	const partMap = new Map(parts.map((p) => [p.type, p.value]));

	const weekday = partMap.get('weekday');
	const month = partMap.get('month');
	const day = partMap.get('day');
	const year = partMap.get('year');
	const hour = partMap.get('hour');
	const minute = partMap.get('minute');
	const dayPeriod = partMap.get('dayPeriod');
	const timeZoneName = partMap.get('timeZoneName');

	return `${weekday} ${month} ${day}, ${year} ${hour}:${minute} ${dayPeriod} ${timeZoneName}`;
}
