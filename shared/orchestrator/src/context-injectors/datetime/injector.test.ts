/**
 * Tests for DateTime context injector.
 */

import { describe, expect, it } from 'vitest';
import type { InjectorContext } from '../types';
import { createDateTimeContextInjector, DateTimeContextInjector } from './injector';

// Helper to create a mock context
function createMockContext(overrides: Partial<InjectorContext> = {}): InjectorContext {
	return {
		timezone: 'America/New_York',
		now: new Date('2025-01-15T12:00:00Z'),
		sessionId: 'test-session-123',
		...overrides,
	};
}

describe('DateTimeContextInjector', () => {
	describe('injector name', () => {
		it('should have name "datetime"', () => {
			const injector = new DateTimeContextInjector();
			expect(injector.name).toBe('datetime');
		});
	});

	describe('injectSystemContext', () => {
		it('should wrap systemContext in <system-context> tags', () => {
			const injector = new DateTimeContextInjector();
			const ctx = createMockContext();

			const result = injector.injectSystemContext(ctx);

			expect(result).toMatch(/^<system-context>.*<\/system-context>$/);
		});

		it('should include "Current date and time:" in systemContext', () => {
			const injector = new DateTimeContextInjector();
			const ctx = createMockContext();

			const result = injector.injectSystemContext(ctx);

			expect(result).toContain('Current date and time:');
		});

		it('should include formatted datetime in systemContext', () => {
			const injector = new DateTimeContextInjector();
			// Use a specific date for predictable output
			const ctx = createMockContext({
				now: new Date('2025-01-15T12:00:00Z'),
				timezone: 'America/New_York',
			});

			const result = injector.injectSystemContext(ctx);

			// The formatted date for 2025-01-15T12:00:00Z in America/New_York (EST, UTC-5)
			// should be Wed Jan 15, 2025 7:00 AM EST
			expect(result).toContain('Wed Jan 15, 2025');
			expect(result).toContain('7:00 AM EST');
		});

		it('should format datetime according to provided timezone', () => {
			const injector = new DateTimeContextInjector();
			const fixedDate = new Date('2025-01-15T12:00:00Z');

			// Same time, different timezones
			const eastResult = injector.injectSystemContext(
				createMockContext({ now: fixedDate, timezone: 'America/New_York' }),
			);
			const westResult = injector.injectSystemContext(
				createMockContext({ now: fixedDate, timezone: 'America/Los_Angeles' }),
			);

			// New York is EST (UTC-5), so 12:00 UTC = 7:00 AM EST
			expect(eastResult).toContain('7:00 AM EST');
			// Los Angeles is PST (UTC-8), so 12:00 UTC = 4:00 AM PST
			expect(westResult).toContain('4:00 AM PST');
		});
	});

	describe('injectResumeContext', () => {
		it('should wrap content in <context-update> tags with type="datetime"', () => {
			const injector = new DateTimeContextInjector();
			const ctx = createMockContext();

			const result = injector.injectResumeContext(ctx);

			expect(result).toBeDefined();
			expect(result).toHaveLength(1);

			const message = result[0];
			expect(message?.content[0]).toMatchObject({
				type: 'text',
				text: expect.stringMatching(/^<context-update type="datetime">.*<\/context-update>$/),
			});
		});

		it('should include "The current date and time is" in resumeMessages', () => {
			const injector = new DateTimeContextInjector();
			const ctx = createMockContext();

			const result = injector.injectResumeContext(ctx);

			const message = result[0];
			const textContent = message?.content[0];
			expect(textContent?.type).toBe('text');
			if (textContent?.type === 'text') {
				expect(textContent.text).toContain('The current date and time is');
			}
		});

		it('should have role "user" for resumeMessages', () => {
			const injector = new DateTimeContextInjector();
			const ctx = createMockContext();

			const result = injector.injectResumeContext(ctx);

			expect(result[0]?.role).toBe('user');
		});

		it('should set timestamp to context now.getTime()', () => {
			const injector = new DateTimeContextInjector();
			const testDate = new Date('2025-06-20T15:30:00Z');
			const ctx = createMockContext({ now: testDate });

			const result = injector.injectResumeContext(ctx);

			expect(result[0]?.timestamp).toBe(testDate.getTime());
		});

		it('should format datetime according to provided timezone', () => {
			const injector = new DateTimeContextInjector();
			const fixedDate = new Date('2025-01-15T12:00:00Z');

			// Same time, different timezones
			const eastResult = injector.injectResumeContext(
				createMockContext({ now: fixedDate, timezone: 'America/New_York' }),
			);
			const westResult = injector.injectResumeContext(
				createMockContext({ now: fixedDate, timezone: 'America/Los_Angeles' }),
			);

			const eastText = eastResult[0]?.content[0];
			const westText = westResult[0]?.content[0];

			expect(eastText?.type === 'text' && eastText.text).toContain('7:00 AM EST');
			expect(westText?.type === 'text' && westText.text).toContain('4:00 AM PST');
		});
	});

	describe('ContextInjector interface', () => {
		it('should implement the ContextInjector interface', () => {
			const injector = new DateTimeContextInjector();

			expect(typeof injector.name).toBe('string');
			expect(typeof injector.injectSystemContext).toBe('function');
			expect(typeof injector.injectResumeContext).toBe('function');
		});
	});
});

describe('createDateTimeContextInjector (deprecated)', () => {
	it('should return a DateTimeContextInjector instance', () => {
		const injector = createDateTimeContextInjector();

		expect(injector.name).toBe('datetime');
		expect(typeof injector.injectSystemContext).toBe('function');
		expect(typeof injector.injectResumeContext).toBe('function');
	});
});
