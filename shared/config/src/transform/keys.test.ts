import { describe, expect, it } from 'vitest';
import { kebabToCamel, transformKeys } from './keys.js';

describe('kebabToCamel', () => {
	it('converts kebab-case to camelCase', () => {
		expect(kebabToCamel('base-url')).toBe('baseUrl');
		expect(kebabToCamel('rate-limit-per-minute')).toBe('rateLimitPerMinute');
		expect(kebabToCamel('api-key')).toBe('apiKey');
		expect(kebabToCamel('my-long-variable-name')).toBe('myLongVariableName');
	});

	it('handles strings without hyphens', () => {
		expect(kebabToCamel('baseurl')).toBe('baseurl');
		expect(kebabToCamel('URL')).toBe('URL');
		expect(kebabToCamel('')).toBe('');
		expect(kebabToCamel('alreadyCamelCase')).toBe('alreadyCamelCase');
	});
});

describe('transformKeys', () => {
	it('transforms object keys recursively', () => {
		const input = {
			'base-url': 'http://example.com',
			'api-config': {
				'rate-limit': 100,
				'max-retries': 3,
			},
		};

		const expected = {
			baseUrl: 'http://example.com',
			apiConfig: {
				rateLimit: 100,
				maxRetries: 3,
			},
		};

		expect(transformKeys(input)).toEqual(expected);
	});

	it('handles arrays', () => {
		const input = [{ 'item-name': 'first' }, { 'item-name': 'second', 'nested-data': { 'deep-key': 'value' } }];

		const expected = [{ itemName: 'first' }, { itemName: 'second', nestedData: { deepKey: 'value' } }];

		expect(transformKeys(input)).toEqual(expected);
	});

	it('handles arrays nested in objects', () => {
		const input = {
			'list-items': [{ 'item-id': 1 }, { 'item-id': 2 }],
		};

		const expected = {
			listItems: [{ itemId: 1 }, { itemId: 2 }],
		};

		expect(transformKeys(input)).toEqual(expected);
	});

	it('handles null/undefined', () => {
		expect(transformKeys(null)).toBe(null);
		expect(transformKeys(undefined)).toBe(undefined);
	});

	it('handles primitives', () => {
		expect(transformKeys('string-value')).toBe('string-value');
		expect(transformKeys(42)).toBe(42);
		expect(transformKeys(true)).toBe(true);
		expect(transformKeys(false)).toBe(false);
		expect(transformKeys(0)).toBe(0);
	});
});
