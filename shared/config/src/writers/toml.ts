/**
 * Write TOML files with key transformation.
 * @module config/writers/toml
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stringify } from 'smol-toml';
import { transformKeysReverse } from '../transform/keys.js';

/**
 * Write data to a TOML file, transforming keys from camelCase to kebab-case.
 *
 * @param filePath - The path to the TOML file
 * @param data - The data to write
 * @throws If writing fails
 *
 * @example
 * await writeTomlFile('./config.toml', { baseUrl: 'http://example.com' });
 * // Writes: base-url = "http://example.com"
 */
export async function writeTomlFile<T extends Record<string, unknown>>(filePath: string, data: T): Promise<void> {
	// Ensure directory exists
	await mkdir(dirname(filePath), { recursive: true });

	// Transform keys to kebab-case
	const kebabData = transformKeysReverse<Record<string, unknown>>(data);

	// Stringify and write
	const content = stringify(kebabData);
	await writeFile(filePath, content, 'utf-8');
}

/**
 * Write a TOML document whose root keys are opaque table identifiers.
 * Root identifiers are preserved verbatim while fields inside each table are normalized to kebab-case.
 */
export async function writeTomlTableMap<T>(filePath: string, data: Record<string, T>): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	const transformed = Object.fromEntries(
		Object.entries(data).map(([key, value]) => [key, transformKeysReverse(value)]),
	);
	await writeFile(filePath, stringify(transformed), 'utf-8');
}
