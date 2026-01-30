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
