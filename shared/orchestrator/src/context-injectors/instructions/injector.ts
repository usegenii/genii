/**
 * Instructions context injector.
 *
 * Injects INSTRUCTIONS.md content into the agent's system prompt.
 * This provides behavioral guidelines and operational rules.
 */

import type { CheckpointMessage } from '../../snapshot/types';
import { INJECTOR_ORDER } from '../order';
import type { ContextInjector, InjectorContext } from '../types';

/**
 * Instructions context injector.
 *
 * This injector provides the INSTRUCTIONS.md content after the soul.
 * It establishes how the agent should behave and interact.
 */
export class InstructionsContextInjector implements ContextInjector {
	readonly name = 'instructions';
	readonly order = INJECTOR_ORDER.INSTRUCTIONS;

	/**
	 * Inject the instructions content into the system prompt.
	 * @param ctx - The injector context
	 * @returns INSTRUCTIONS.md content, or undefined if not available
	 */
	injectSystemContext(ctx: InjectorContext): string | undefined {
		return ctx.guidance?.instructions || undefined;
	}

	/**
	 * No resume context for instructions - they don't change between sessions.
	 */
	injectResumeContext(_ctx: InjectorContext): CheckpointMessage[] | undefined {
		return undefined;
	}
}
