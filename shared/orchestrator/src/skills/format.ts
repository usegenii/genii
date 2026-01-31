/**
 * Skills prompt formatting.
 *
 * Generates markdown sections for injecting skill information into system prompts.
 */

import type { LoadedSkill } from './types';

/**
 * Format loaded skills for inclusion in the system prompt.
 * Returns an empty string if no skills are provided.
 */
export function formatSkillsForPrompt(skills: LoadedSkill[]): string {
	if (!skills || skills.length === 0) {
		return '';
	}

	const lines: string[] = [
		'## Available Skills',
		'',
		'The following skills provide specialized knowledge for CLI tools and workflows.',
		"Read a skill's file to get detailed instructions for that domain.",
		'',
	];

	for (const skill of skills) {
		lines.push(`- **${skill.name}**: ${skill.description}. Path: \`${skill.path}\``);
	}

	return lines.join('\n');
}
