import { describe, expect, it } from 'vitest';
import { parseModelIdentifier } from '../identifier';

describe('parseModelIdentifier', () => {
	it('should parse provider/model-name', () => {
		const result = parseModelIdentifier('anthropic/opus-4.5');
		expect(result).toEqual({ provider: 'anthropic', modelName: 'opus-4.5' });
	});

	it('should parse model names containing slashes', () => {
		const result = parseModelIdentifier('acme/org/model-v1');
		expect(result).toEqual({ provider: 'acme', modelName: 'org/model-v1' });
	});

	it('should parse model names with multiple slashes', () => {
		const result = parseModelIdentifier('provider/org/sub/model-name');
		expect(result).toEqual({ provider: 'provider', modelName: 'org/sub/model-name' });
	});

	it('should throw for missing provider (no slash)', () => {
		expect(() => parseModelIdentifier('opus-4.5')).toThrow('Invalid model identifier format');
	});

	it('should throw for empty provider (leading slash)', () => {
		expect(() => parseModelIdentifier('/opus-4.5')).toThrow('Invalid model identifier format');
	});

	it('should throw for empty model name (trailing slash)', () => {
		expect(() => parseModelIdentifier('anthropic/')).toThrow('Invalid model identifier format');
	});

	it('should throw for empty string', () => {
		expect(() => parseModelIdentifier('')).toThrow('Invalid model identifier format');
	});
});
