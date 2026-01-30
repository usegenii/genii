import { describe, expect, it } from 'vitest';
import { getFormatter, getOutputFormat, type OutputFormat } from '../formatter';
import { HumanFormatter } from '../human';
import { JsonFormatter } from '../json';
import { QuietFormatter } from '../quiet';

describe('getFormatter()', () => {
	it('should return HumanFormatter for "human" format', () => {
		const formatter = getFormatter('human');
		expect(formatter).toBeInstanceOf(HumanFormatter);
	});

	it('should return JsonFormatter for "json" format', () => {
		const formatter = getFormatter('json');
		expect(formatter).toBeInstanceOf(JsonFormatter);
	});

	it('should return QuietFormatter for "quiet" format', () => {
		const formatter = getFormatter('quiet');
		expect(formatter).toBeInstanceOf(QuietFormatter);
	});

	it('should return HumanFormatter for unknown format (default)', () => {
		const formatter = getFormatter('unknown' as OutputFormat);
		expect(formatter).toBeInstanceOf(HumanFormatter);
	});
});

describe('getOutputFormat()', () => {
	it('should return "quiet" when quiet option is true', () => {
		const format = getOutputFormat({ quiet: true });
		expect(format).toBe('quiet');
	});

	it('should return "json" when output option is "json"', () => {
		const format = getOutputFormat({ output: 'json' });
		expect(format).toBe('json');
	});

	it('should return "quiet" when output option is "quiet"', () => {
		const format = getOutputFormat({ output: 'quiet' });
		expect(format).toBe('quiet');
	});

	it('should return "human" by default', () => {
		const format = getOutputFormat({});
		expect(format).toBe('human');
	});

	it('should prioritize quiet option over output option', () => {
		const format = getOutputFormat({ quiet: true, output: 'json' });
		expect(format).toBe('quiet');
	});
});
