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
 * Check whether a value is a plain record whose keys represent schema fields.
 * TOML scalar objects such as dates must pass through without key transformation.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
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

	if (isPlainRecord(obj)) {
		return Object.fromEntries(
			Object.entries(obj).map(([key, value]) => [kebabToCamel(key), transformKeys(value)]),
		) as T;
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

	if (isPlainRecord(obj)) {
		return Object.fromEntries(
			Object.entries(obj).map(([key, value]) => [camelToKebab(key), transformKeysReverse(value)]),
		) as T;
	}

	return obj as T;
}
