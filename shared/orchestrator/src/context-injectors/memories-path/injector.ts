/**
 * Memories path context injector.
 *
 * Injects the path to the memories directory into the agent's system prompt.
 * This allows the agent to know where to persist and retrieve memories.
 */

import { join } from 'node:path';
import type { CheckpointMessage } from '../../snapshot/types';
import { INJECTOR_ORDER } from '../order';
import type { ContextInjector, InjectorContext } from '../types';

/**
 * Memories path context injector.
 *
 * This injector provides the path to the memories directory,
 * wrapped in a `<memories-path>` tag for easy extraction.
 */
export class MemoriesPathContextInjector implements ContextInjector {
	readonly name = 'memories-path';
	readonly order = INJECTOR_ORDER.MEMORIES_PATH;

	/**
	 * Inject the memories path into the system prompt.
	 * @param ctx - The injector context
	 * @returns Memories path in XML tag format, or undefined if not available
	 */
	injectSystemContext(ctx: InjectorContext): string | undefined {
		const root = ctx.guidancePath ?? ctx.guidance?.root;
		if (!root) {
			return undefined;
		}
		return `<memories-path>${join(root, 'memories')}</memories-path>`;
	}

	/**
	 * No resume context for memories path - it doesn't change between sessions.
	 */
	injectResumeContext(_ctx: InjectorContext): CheckpointMessage[] | undefined {
		return undefined;
	}
}
