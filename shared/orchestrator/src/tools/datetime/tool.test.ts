/**
 * Tests for DateTime tool.
 */

import { describe, expect, it, vi } from 'vitest';
import { createDateTimeTool, type DateTimeToolConfig } from './tool.js';

describe('createDateTimeTool', () => {
	const defaultConfig: DateTimeToolConfig = {
		timezone: 'America/New_York',
	};

	// Create a mock context
	function createMockContext() {
		return {
			sessionId: 'test-session',
			guidance: {} as never,
			signal: new AbortController().signal,
			step: {} as never,
			emitProgress: vi.fn(),
			log: vi.fn(),
		};
	}

	it('should create a tool with correct metadata', () => {
		const tool = createDateTimeTool(defaultConfig);
		expect(tool.name).toBe('datetime');
		expect(tool.label).toBe('DateTime');
		expect(tool.category).toBe('utility');
		expect(tool.description).toContain('Parse natural language date expressions');
	});

	describe('output format', () => {
		it('should return output with expected fields (iso, formatted, unix)', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const result = await tool.execute({ expression: 'tomorrow' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				expect(result.output).toHaveProperty('iso');
				expect(result.output).toHaveProperty('formatted');
				expect(result.output).toHaveProperty('unix');
				expect(typeof result.output.iso).toBe('string');
				expect(typeof result.output.formatted).toBe('string');
				expect(typeof result.output.unix).toBe('number');
			}
		});

		it('should return a valid ISO 8601 date string', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const result = await tool.execute({ expression: 'tomorrow' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				// Verify ISO format - should be parseable and match the pattern
				const parsed = new Date(result.output.iso);
				expect(Number.isNaN(parsed.getTime())).toBe(false);
				expect(result.output.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
			}
		});

		it('should return unix timestamp in milliseconds', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const result = await tool.execute({ expression: 'tomorrow' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				// Unix timestamp should be a reasonable number (not seconds, but milliseconds)
				expect(result.output.unix).toBeGreaterThan(Date.now() - 86400000); // At least yesterday
				expect(result.output.unix).toBeLessThan(Date.now() + 7 * 86400000); // Within a week
			}
		});
	});

	describe('custom reference date (from)', () => {
		it('should use custom from reference date for parsing', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			// Use a fixed reference date: January 15, 2025
			const referenceDate = '2025-01-15T12:00:00.000Z';
			const result = await tool.execute({ expression: 'tomorrow', from: referenceDate }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				// "tomorrow" from Jan 15 should be Jan 16
				const parsed = new Date(result.output.iso);
				expect(parsed.getUTCDate()).toBe(16);
				expect(parsed.getUTCMonth()).toBe(0); // January
				expect(parsed.getUTCFullYear()).toBe(2025);
			}
		});

		it('should return error for invalid from reference date', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const result = await tool.execute({ expression: 'tomorrow', from: 'not-a-valid-date' }, context);

			expect(result.status).toBe('error');
			if (result.status === 'error') {
				expect(result.error).toContain('Invalid reference date');
				expect(result.error).toContain('not-a-valid-date');
				expect(result.retryable).toBe(false);
			}
		});

		it('should calculate relative dates based on from date', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			// Reference: March 1, 2025
			const referenceDate = '2025-03-01T10:00:00.000Z';
			const result = await tool.execute({ expression: 'in 5 days', from: referenceDate }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				const parsed = new Date(result.output.iso);
				expect(parsed.getUTCDate()).toBe(6);
				expect(parsed.getUTCMonth()).toBe(2); // March
				expect(parsed.getUTCFullYear()).toBe(2025);
			}
		});
	});

	describe('unparseable expressions', () => {
		it('should return error for unparseable expression', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const result = await tool.execute({ expression: 'xyzzy gibberish' }, context);

			expect(result.status).toBe('error');
			if (result.status === 'error') {
				expect(result.error).toContain('Could not parse date expression');
				expect(result.error).toContain('xyzzy gibberish');
				expect(result.retryable).toBe(false);
			}
		});

		it('should provide helpful examples in error message', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const result = await tool.execute({ expression: 'unknown format' }, context);

			expect(result.status).toBe('error');
			if (result.status === 'error') {
				// Error message should suggest valid expressions
				expect(result.error).toContain('next friday');
				expect(result.error).toContain('in 2 weeks');
				expect(result.error).toContain('3 days ago');
			}
		});

		it('should return error for empty expression', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const result = await tool.execute({ expression: '' }, context);

			expect(result.status).toBe('error');
			if (result.status === 'error') {
				expect(result.error).toContain('Could not parse');
			}
		});
	});

	describe('natural language expressions', () => {
		it('should parse "tomorrow"', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const now = new Date();
			const result = await tool.execute({ expression: 'tomorrow' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				const parsed = new Date(result.output.iso);
				// Tomorrow should be within 24-48 hours from now
				const diffMs = parsed.getTime() - now.getTime();
				const diffHours = diffMs / (1000 * 60 * 60);
				expect(diffHours).toBeGreaterThan(0);
				expect(diffHours).toBeLessThan(48);
			}
		});

		it('should parse "next friday"', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const result = await tool.execute({ expression: 'next friday' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				const parsed = new Date(result.output.iso);
				// Friday is day 5
				expect(parsed.getDay()).toBe(5);
				// Should be in the future
				expect(parsed.getTime()).toBeGreaterThan(Date.now());
			}
		});

		it('should parse "in 2 weeks"', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const now = new Date();
			const result = await tool.execute({ expression: 'in 2 weeks' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				const parsed = new Date(result.output.iso);
				const diffMs = parsed.getTime() - now.getTime();
				const diffDays = diffMs / (1000 * 60 * 60 * 24);
				// Should be approximately 14 days in the future (allow some tolerance)
				expect(diffDays).toBeGreaterThan(13);
				expect(diffDays).toBeLessThan(15);
			}
		});

		it('should parse "3 days ago"', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const now = new Date();
			const result = await tool.execute({ expression: '3 days ago' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				const parsed = new Date(result.output.iso);
				const diffMs = now.getTime() - parsed.getTime();
				const diffDays = diffMs / (1000 * 60 * 60 * 24);
				// Should be approximately 3 days in the past (allow some tolerance)
				expect(diffDays).toBeGreaterThan(2);
				expect(diffDays).toBeLessThan(4);
			}
		});

		it('should parse "yesterday"', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const now = new Date();
			const result = await tool.execute({ expression: 'yesterday' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				const parsed = new Date(result.output.iso);
				const diffMs = now.getTime() - parsed.getTime();
				const diffHours = diffMs / (1000 * 60 * 60);
				// Yesterday should be within 0-48 hours in the past
				expect(diffHours).toBeGreaterThan(0);
				expect(diffHours).toBeLessThan(48);
			}
		});

		it('should parse "next monday at 3pm"', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const result = await tool.execute({ expression: 'next monday at 3pm' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				const parsed = new Date(result.output.iso);
				// Monday is day 1
				expect(parsed.getDay()).toBe(1);
				// Should be in the future
				expect(parsed.getTime()).toBeGreaterThan(Date.now());
			}
		});

		it('should parse absolute dates like "January 15, 2025"', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const result = await tool.execute({ expression: 'January 15, 2025' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				const parsed = new Date(result.output.iso);
				expect(parsed.getUTCMonth()).toBe(0); // January
				expect(parsed.getUTCDate()).toBe(15);
				expect(parsed.getUTCFullYear()).toBe(2025);
			}
		});

		it('should parse "in 1 hour"', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			const now = new Date();
			const result = await tool.execute({ expression: 'in 1 hour' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				const parsed = new Date(result.output.iso);
				const diffMs = parsed.getTime() - now.getTime();
				const diffMinutes = diffMs / (1000 * 60);
				// Should be approximately 60 minutes in the future (allow some tolerance)
				expect(diffMinutes).toBeGreaterThan(55);
				expect(diffMinutes).toBeLessThan(65);
			}
		});
	});

	describe('timezone handling', () => {
		it('should apply timezone to formatted output', async () => {
			const tool = createDateTimeTool({ timezone: 'America/New_York' });
			const context = createMockContext();

			const result = await tool.execute({ expression: 'tomorrow at noon' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				// Formatted output should include timezone indicator (EST or EDT)
				expect(result.output.formatted).toMatch(/E[SD]T/);
			}
		});

		it('should use Pacific timezone when configured', async () => {
			const tool = createDateTimeTool({ timezone: 'America/Los_Angeles' });
			const context = createMockContext();

			const result = await tool.execute({ expression: 'tomorrow at noon' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				// Formatted output should include Pacific timezone indicator (PST or PDT)
				expect(result.output.formatted).toMatch(/P[SD]T/);
			}
		});

		it('should use UTC timezone when configured', async () => {
			const tool = createDateTimeTool({ timezone: 'UTC' });
			const context = createMockContext();

			const result = await tool.execute({ expression: 'tomorrow at noon' }, context);

			expect(result.status).toBe('success');
			if (result.status === 'success') {
				// Formatted output should include UTC
				expect(result.output.formatted).toContain('UTC');
			}
		});

		it('should produce different formatted times for different timezones', async () => {
			const nyTool = createDateTimeTool({ timezone: 'America/New_York' });
			const laTool = createDateTimeTool({ timezone: 'America/Los_Angeles' });
			const context = createMockContext();

			// Use a fixed reference time to ensure consistency
			const referenceDate = '2025-06-15T18:00:00.000Z'; // 6 PM UTC

			const nyResult = await nyTool.execute({ expression: 'now', from: referenceDate }, context);
			const laResult = await laTool.execute({ expression: 'now', from: referenceDate }, context);

			expect(nyResult.status).toBe('success');
			expect(laResult.status).toBe('success');

			if (nyResult.status === 'success' && laResult.status === 'success') {
				// The ISO times should be the same (both represent the same instant)
				expect(nyResult.output.iso).toBe(laResult.output.iso);
				// But the formatted strings should be different (different local times)
				expect(nyResult.output.formatted).not.toBe(laResult.output.formatted);
			}
		});
	});

	describe('logging', () => {
		it('should log parsing info', async () => {
			const tool = createDateTimeTool(defaultConfig);
			const context = createMockContext();

			await tool.execute({ expression: 'next friday' }, context);

			expect(context.log).toHaveBeenCalledWith('info', expect.stringContaining('Parsing date expression'));
			expect(context.log).toHaveBeenCalledWith('info', expect.stringContaining('next friday'));
		});
	});
});
