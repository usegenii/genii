/**
 * Skills context injector.
 *
 * Injects available skills into the agent's system prompt.
 * This informs the agent about specialized skill bundles it can use.
 */

import { formatSkillsForPrompt } from '../../skills/format';
import type { CheckpointMessage } from '../../snapshot/types';
import { INJECTOR_ORDER } from '../order';
import type { ContextInjector, InjectorContext } from '../types';

/**
 * Skills context injector.
 *
 * This injector lists available skill bundles that the agent can reference.
 * Skills provide specialized knowledge for specific domains.
 */
export class SkillsContextInjector implements ContextInjector {
	readonly name = 'skills';
	readonly order = INJECTOR_ORDER.SKILLS;

	/**
	 * Inject the available skills into the system prompt.
	 * @param ctx - The injector context
	 * @returns Formatted skills section, or undefined if no skills
	 */
	injectSystemContext(ctx: InjectorContext): string | undefined {
		if (!ctx.skills?.length) {
			return undefined;
		}
		return formatSkillsForPrompt(ctx.skills) || undefined;
	}

	/**
	 * No resume context for skills - they're static per session.
	 */
	injectResumeContext(_ctx: InjectorContext): CheckpointMessage[] | undefined {
		return undefined;
	}
}
