/**
 * Tasks prompt formatting.
 *
 * Generates markdown sections for listing available tasks in system prompts.
 */

import type { TaskInfo } from '../../guidance/types';

/**
 * Format available tasks for inclusion in the system prompt.
 * Returns undefined if no tasks are provided.
 */
export function formatTasksForPrompt(tasks: TaskInfo[]): string | undefined {
	if (!tasks || tasks.length === 0) {
		return undefined;
	}

	const lines: string[] = [
		'## Available Tasks',
		'',
		'The following tasks are available. Read a task file to get full instructions.',
		'',
	];

	for (const task of tasks) {
		const description = task.description ?? 'No description';
		lines.push(`- **${task.title}**: ${description}. Path: \`${task.path}\``);
	}

	return lines.join('\n');
}
