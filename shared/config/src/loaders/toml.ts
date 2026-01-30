import { readFile } from 'node:fs/promises';
import { parse } from 'smol-toml';
import { transformKeys } from '../transform/keys.js';

/**
 * Read and parse a TOML file, transforming keys from kebab-case to camelCase.
 *
 * @param filePath - The path to the TOML file
 * @returns The parsed and transformed TOML content
 * @throws If the file doesn't exist or parsing fails
 *
 * @example
 * const config = await readTomlFile<AppConfig>('./config.toml');
 */
export async function readTomlFile<T>(filePath: string): Promise<T> {
	const content = await readFile(filePath, 'utf-8');
	const parsed = parse(content);
	return transformKeys<T>(parsed);
}

/**
 * Read and parse a TOML file if it exists, transforming keys from kebab-case to camelCase.
 *
 * @param filePath - The path to the TOML file
 * @returns The parsed and transformed TOML content, or undefined if the file doesn't exist
 * @throws If parsing fails (but not if the file doesn't exist)
 *
 * @example
 * const config = await readTomlFileOptional<AppConfig>('./config.toml');
 * if (config) {
 *   // use config
 * }
 */
export async function readTomlFileOptional<T>(filePath: string): Promise<T | undefined> {
	try {
		const content = await readFile(filePath, 'utf-8');
		const parsed = parse(content);
		return transformKeys<T>(parsed);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
}
