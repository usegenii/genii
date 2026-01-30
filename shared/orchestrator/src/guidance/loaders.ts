/**
 * Document loaders for tasks and skills.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { SkillBundle, SkillInfo, TaskDocument, TaskInfo } from './types';

/**
 * Parse frontmatter from markdown content.
 * Returns the frontmatter object and the content without frontmatter.
 */
export function parseFrontmatter(content: string): {
	metadata: Record<string, unknown>;
	content: string;
} {
	const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
	const match = frontmatterRegex.exec(content);

	if (!match?.[1]) {
		return { metadata: {}, content };
	}

	const frontmatterStr = match[1];
	const metadata: Record<string, unknown> = {};

	// Simple YAML-like parsing (key: value)
	for (const line of frontmatterStr.split('\n')) {
		const colonIndex = line.indexOf(':');
		if (colonIndex === -1) continue;

		const key = line.slice(0, colonIndex).trim();
		let value: unknown = line.slice(colonIndex + 1).trim();

		// Try to parse as JSON for arrays and objects
		if ((value as string).startsWith('[') || (value as string).startsWith('{')) {
			try {
				value = JSON.parse(value as string);
			} catch {
				// Keep as string
			}
		} else if (value === 'true') {
			value = true;
		} else if (value === 'false') {
			value = false;
		} else if (!Number.isNaN(Number(value)) && value !== '') {
			value = Number(value);
		}

		metadata[key] = value;
	}

	return {
		metadata,
		content: content.slice(match[0].length),
	};
}

/**
 * Extract title from markdown content.
 * Looks for the first H1 heading.
 */
export function extractTitle(content: string): string | null {
	const titleRegex = /^#\s+(.+)$/m;
	const match = titleRegex.exec(content);
	return match?.[1]?.trim() ?? null;
}

/**
 * Load a task document from a file.
 */
export async function loadTaskDocument(path: string): Promise<TaskDocument | null> {
	try {
		const fileContent = await readFile(path, 'utf-8');
		const { metadata, content } = parseFrontmatter(fileContent);

		// Get ID from frontmatter or filename
		const id = (metadata.id as string | undefined) ?? basename(path, '.md').toLowerCase().replace(/\s+/g, '-');

		// Get title from frontmatter, H1, or filename
		const title = (metadata.title as string | undefined) ?? extractTitle(content) ?? basename(path, '.md');

		return {
			id,
			title,
			content,
			metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

/**
 * List all tasks in a directory.
 */
export async function listTasks(tasksDir: string): Promise<TaskInfo[]> {
	try {
		const entries = await readdir(tasksDir, { withFileTypes: true });
		const tasks: TaskInfo[] = [];

		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith('.md')) {
				continue;
			}

			const path = join(tasksDir, entry.name);
			const doc = await loadTaskDocument(path);

			if (doc) {
				tasks.push({
					id: doc.id,
					title: doc.title,
					path,
				});
			}
		}

		return tasks;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}
		throw error;
	}
}

/**
 * Load a skill bundle from a directory.
 */
export async function loadSkillBundle(skillDir: string): Promise<SkillBundle | null> {
	try {
		const readmePath = join(skillDir, 'README.md');
		const readme = await readFile(readmePath, 'utf-8');

		const artifacts = new Map<string, string>();
		const entries = await readdir(skillDir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isFile() || entry.name === 'README.md') {
				continue;
			}

			const filePath = join(skillDir, entry.name);
			const content = await readFile(filePath, 'utf-8');
			artifacts.set(entry.name, content);
		}

		return {
			path: skillDir,
			readme,
			artifacts,
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

/**
 * List all skills in a directory.
 * Skills are subdirectories containing a README.md file.
 */
export async function listSkills(skillsDir: string): Promise<SkillInfo[]> {
	try {
		const entries = await readdir(skillsDir, { withFileTypes: true });
		const skills: SkillInfo[] = [];

		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}

			const skillPath = join(skillsDir, entry.name);
			const readmePath = join(skillPath, 'README.md');

			try {
				await stat(readmePath);
				skills.push({
					path: skillPath,
					name: entry.name,
				});
			} catch {
				// No README.md, skip this directory
			}
		}

		return skills;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}
		throw error;
	}
}

/**
 * Recursively list skills in a directory (for nested skill structures).
 */
export async function listSkillsRecursive(skillsDir: string, prefix = ''): Promise<SkillInfo[]> {
	try {
		const entries = await readdir(skillsDir, { withFileTypes: true });
		const skills: SkillInfo[] = [];

		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}

			const skillPath = join(skillsDir, entry.name);
			const readmePath = join(skillPath, 'README.md');
			const skillName = prefix ? `${prefix}/${entry.name}` : entry.name;

			try {
				await stat(readmePath);
				skills.push({
					path: skillPath,
					name: skillName,
				});
			} catch {
				// No README.md, check for nested skills
			}

			// Always check for nested skills
			const nested = await listSkillsRecursive(skillPath, skillName);
			skills.push(...nested);
		}

		return skills;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}
		throw error;
	}
}
