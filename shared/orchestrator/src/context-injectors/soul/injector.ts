/**
 * Soul context injector.
 *
 * Injects SOUL.md content into the agent's system prompt.
 * This defines the agent's core identity and personality.
 */

import type { CheckpointMessage } from '../../snapshot/types';
import { INJECTOR_ORDER } from '../order';
import type { ContextInjector, InjectorContext } from '../types';

/**
 * Soul context injector.
 *
 * This injector provides the SOUL.md content at the beginning of the system prompt.
 * It establishes the agent's fundamental identity and values.
 */
export class SoulContextInjector implements ContextInjector {
	readonly name = 'soul';
	readonly order = INJECTOR_ORDER.SOUL;

	/**
	 * Inject the soul content into the system prompt.
	 * @param ctx - The injector context
	 * @returns SOUL.md content, or undefined if not available
	 */
	injectSystemContext(ctx: InjectorContext): string | undefined {
		return ctx.guidance?.soul || undefined;
	}

	/**
	 * No resume context for soul - it doesn't change between sessions.
	 */
	injectResumeContext(_ctx: InjectorContext): CheckpointMessage[] | undefined {
		return undefined;
	}
}
