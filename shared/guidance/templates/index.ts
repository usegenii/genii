/**
 * Templates module that loads templates from the filesystem.
 *
 * In development mode, this reads files from disk at runtime.
 * In production, this module's content is inlined by tsup during build.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..');

/**
 * Recursively get all template files
 */
function getAllFiles(dir: string, baseDir: string): Array<{ path: string; content: string }> {
	const files: Array<{ path: string; content: string }> = [];

	if (!statSync(dir).isDirectory()) {
		return files;
	}

	const entries = readdirSync(dir);

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);

		if (stat.isDirectory()) {
			files.push(...getAllFiles(fullPath, baseDir));
		} else {
			const content = readFileSync(fullPath, 'utf-8');
			const relativePath = relative(baseDir, fullPath);
			files.push({ path: relativePath, content });
		}
	}

	return files;
}

/**
 * Load all templates from the filesystem
 */
const allTemplates = getAllFiles(TEMPLATES_DIR, TEMPLATES_DIR);

/**
 * Export templates as a Map for consistency with bundled version
 */
export const templates = new Map(allTemplates.map(({ path, content }) => [path, content]));

/**
 * Export list of template paths
 */
export const templatePaths = Array.from(templates.keys());
