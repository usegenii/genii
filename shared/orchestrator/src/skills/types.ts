/**
 * Skills system types.
 *
 * Skills are specialized knowledge bundles loaded from {dataDir}/skills/
 * that provide CLI tool expertise and workflow guidance to agents.
 */

import type { Logger } from '../types/logger';

/**
 * Skill manifest parsed from SKILL.md frontmatter.
 */
export interface SkillManifest {
	/** Skill name */
	name: string;
	/** Brief description of what the skill provides */
	description: string;
	/** Optional homepage URL for the skill/tool */
	homepage?: string;
	/** Additional metadata */
	metadata?: {
		clawdbot?: {
			/** Emoji for display purposes */
			emoji?: string;
			/** Requirements for the skill to be available */
			requires?: {
				/** Binary names that must be in PATH */
				bins?: string[];
			};
		};
	};
}

/**
 * A loaded skill that is available for use.
 */
export interface LoadedSkill {
	/** Skill name from manifest */
	name: string;
	/** Skill description from manifest */
	description: string;
	/** Absolute path to the SKILL.md file */
	path: string;
}

/**
 * Options for creating a skills loader.
 */
export interface SkillsLoaderOptions {
	/** Directory containing skill folders */
	skillsDir: string;
	/** Logger for debugging skill loading */
	logger?: Logger;
}

/**
 * Skills loader interface.
 */
export interface SkillsLoader {
	/**
	 * Load all available skills from the skills directory.
	 * Skills with missing binary requirements are filtered out.
	 */
	loadAll(): Promise<LoadedSkill[]>;
}
