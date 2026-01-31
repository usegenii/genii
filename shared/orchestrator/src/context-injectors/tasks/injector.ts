/**
 * Tasks context injector.
 *
 * Injects available task documents into the agent's system prompt.
 * This informs the agent about tasks it can work on.
 */

import type { CheckpointMessage } from '../../snapshot/types';
import { INJECTOR_ORDER } from '../order';
import type { ContextInjector, InjectorContext } from '../types';
import { formatTasksForPrompt } from './format';

/**
 * Tasks context injector.
 *
 * This injector lists available task documents that the agent can reference.
 * Each task has a title, description, and path to the full document.
 */
export class TasksContextInjector implements ContextInjector {
	readonly name = 'tasks';
	readonly order = INJECTOR_ORDER.TASKS;

	/**
	 * Inject the available tasks into the system prompt.
	 * @param ctx - The injector context
	 * @returns Formatted tasks section, or undefined if no tasks
	 */
	async injectSystemContext(ctx: InjectorContext): Promise<string | undefined> {
		if (!ctx.guidance) {
			return undefined;
		}

		const tasks = await ctx.guidance.listTasks();
		if (!tasks.length) {
			return undefined;
		}

		return formatTasksForPrompt(tasks);
	}

	/**
	 * No resume context for tasks - they're listed fresh each session.
	 */
	injectResumeContext(_ctx: InjectorContext): CheckpointMessage[] | undefined {
		return undefined;
	}
}
