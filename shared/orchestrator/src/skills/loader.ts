/**
 * Skills loader implementation.
 *
 * Scans {dataDir}/skills/ for skill folders containing SKILL.md,
 * parses frontmatter, and filters by available binaries.
 */

import { accessSync, constants } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { parseFrontmatter } from '../guidance/loaders';
import { type Logger, noopLogger } from '../types/logger';
import type { LoadedSkill, SkillManifest, SkillsLoader, SkillsLoaderOptions } from './types';

/**
 * Check if all required binaries are available in PATH.
 * Uses synchronous filesystem access to avoid subprocess overhead.
 */
function checkBinsAvailable(bins: string[], logger: Logger): boolean {
	const pathDirs = process.env.PATH?.split(delimiter) ?? [];

	for (const bin of bins) {
		let found = false;

		for (const dir of pathDirs) {
			try {
				const binPath = join(dir, bin);
				accessSync(binPath, constants.X_OK);
				found = true;
				break;
			} catch {
				// Binary not found in this directory, continue searching
			}
		}

		if (!found) {
			logger.debug({ bin }, 'Required binary not found in PATH');
			return false;
		}
	}

	return true;
}

/**
 * Load a single skill from a directory.
 * Returns null if the skill is unavailable (missing SKILL.md, invalid frontmatter, or missing binaries).
 */
async function loadSkill(skillDir: string, logger: Logger): Promise<LoadedSkill | null> {
	const skillMdPath = join(skillDir, 'SKILL.md');

	// Check if SKILL.md exists
	try {
		await stat(skillMdPath);
	} catch {
		logger.debug({ skillDir }, 'Skipping directory - no SKILL.md found');
		return null;
	}

	// Read and parse SKILL.md
	let content: string;
	try {
		content = await readFile(skillMdPath, 'utf-8');
	} catch (error) {
		logger.warn({ skillDir, error }, 'Failed to read SKILL.md');
		return null;
	}

	const { metadata } = parseFrontmatter(content);

	// Validate required fields
	const name = metadata.name as string | undefined;
	const description = metadata.description as string | undefined;

	if (!name || !description) {
		logger.warn({ skillDir, metadata }, 'Skill missing required name or description in frontmatter');
		return null;
	}

	// Parse metadata for binary requirements
	const skillMetadata = metadata.metadata as SkillManifest['metadata'] | undefined;
	const requiredBins = skillMetadata?.clawdbot?.requires?.bins;

	// Check if required binaries are available
	if (requiredBins && requiredBins.length > 0) {
		if (!checkBinsAvailable(requiredBins, logger)) {
			logger.debug({ skillDir, name, requiredBins }, 'Skill hidden - required binaries not available');
			return null;
		}
		logger.debug({ skillDir, name, requiredBins }, 'Skill binary requirements satisfied');
	}

	logger.debug({ skillDir, name, description }, 'Skill loaded successfully');

	return {
		name,
		description,
		path: skillMdPath,
	};
}

/**
 * Create a skills loader.
 */
export function createSkillsLoader(options: SkillsLoaderOptions): SkillsLoader {
	const { skillsDir, logger = noopLogger } = options;

	return {
		async loadAll(): Promise<LoadedSkill[]> {
			logger.debug({ skillsDir }, 'Loading skills from directory');

			// Check if skills directory exists
			try {
				const entries = await readdir(skillsDir, { withFileTypes: true });
				const skills: LoadedSkill[] = [];

				for (const entry of entries) {
					if (!entry.isDirectory()) {
						continue;
					}

					const skillPath = join(skillsDir, entry.name);
					const skill = await loadSkill(skillPath, logger);

					if (skill) {
						skills.push(skill);
					}
				}

				logger.info({ skillsDir, count: skills.length, skills: skills.map((s) => s.name) }, 'Skills loaded');
				return skills;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					logger.debug({ skillsDir }, 'Skills directory does not exist');
					return [];
				}
				throw error;
			}
		},
	};
}
