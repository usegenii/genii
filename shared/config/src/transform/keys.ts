/**
 * Convert a kebab-case string to camelCase.
 *
 * @param str - The kebab-case string to convert
 * @returns The camelCase converted string
 *
 * @example
 * kebabToCamel('base-url') // 'baseUrl'
 * kebabToCamel('rate-limit-per-minute') // 'rateLimitPerMinute'
 */
export function kebabToCamel(str: string): string {
	return str.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Recursively transform all object keys from kebab-case to camelCase.
 *
 * @param obj - The object to transform
 * @returns The object with all keys converted to camelCase
 *
 * @example
 * transformKeys({ 'base-url': 'http://example.com' })
 * // { baseUrl: 'http://example.com' }
 *
 * transformKeys({ 'api-config': { 'rate-limit': 100 } })
 * // { apiConfig: { rateLimit: 100 } }
 */
export function transformKeys<T>(obj: unknown): T {
	if (obj === null || obj === undefined) {
		return obj as T;
	}

	if (Array.isArray(obj)) {
		return obj.map((item) => transformKeys(item)) as T;
	}

	if (typeof obj === 'object') {
		const result: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(obj)) {
			const camelKey = kebabToCamel(key);
			result[camelKey] = transformKeys(value);
		}

		return result as T;
	}

	return obj as T;
}

/**
 * Convert a camelCase string to kebab-case.
 *
 * @param str - The camelCase string to convert
 * @returns The kebab-case converted string
 *
 * @example
 * camelToKebab('baseUrl') // 'base-url'
 * camelToKebab('rateLimitPerMinute') // 'rate-limit-per-minute'
 */
export function camelToKebab(str: string): string {
	return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Recursively transform all object keys from camelCase to kebab-case.
 *
 * @param obj - The object to transform
 * @returns The object with all keys converted to kebab-case
 *
 * @example
 * transformKeysReverse({ baseUrl: 'http://example.com' })
 * // { 'base-url': 'http://example.com' }
 *
 * transformKeysReverse({ apiConfig: { rateLimit: 100 } })
 * // { 'api-config': { 'rate-limit': 100 } }
 */
export function transformKeysReverse<T>(obj: unknown): T {
	if (obj === null || obj === undefined) {
		return obj as T;
	}

	if (Array.isArray(obj)) {
		return obj.map((item) => transformKeysReverse(item)) as T;
	}

	if (typeof obj === 'object') {
		const result: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(obj)) {
			const kebabKey = camelToKebab(key);
			result[kebabKey] = transformKeysReverse(value);
		}

		return result as T;
	}

	return obj as T;
}
