/**
 * Context injector system types.
 *
 * Context injectors allow components to dynamically inject context into agent sessions.
 * They can add to the system prompt (for new sessions) or prepend messages (when resuming).
 */

import type { GuidanceContext } from '../guidance/types';
import type { LoadedSkill } from '../skills/types';
import type { CheckpointMessage } from '../snapshot/types';

/**
 * Result of a context injection.
 */
export interface ContextInjection {
	/** Content added to the system prompt */
	systemContext?: string;
	/** Messages prepended when resuming a session via continue() */
	resumeMessages?: CheckpointMessage[];
}

/**
 * Context provided to injectors.
 */
export interface InjectorContext {
	/** User's timezone (e.g., 'America/New_York') */
	timezone: string;
	/** Current date and time */
	now: Date;
	/** Session ID of the agent */
	sessionId: string;
	/** Guidance context with access to soul, instructions, tasks, etc. */
	guidance?: GuidanceContext;
	/** Loaded skills available to the agent */
	skills?: LoadedSkill[];
	/** Path to the guidance directory */
	guidancePath?: string;
}

/**
 * A context injector that can add dynamic context to agent sessions.
 *
 * Injectors provide either system context (for new sessions) or resume messages
 * (for continued sessions), but not both at the same time.
 */
export interface ContextInjector {
	/** Unique name for this injector */
	readonly name: string;

	/** Ordering for this injector (lower values run first) */
	readonly order: number;

	/**
	 * Inject context for the system prompt (new sessions).
	 * @param ctx - The injector context
	 * @returns System context string to append to the system prompt, or undefined
	 */
	injectSystemContext(ctx: InjectorContext): string | undefined | Promise<string | undefined>;

	/**
	 * Inject messages for resume operations.
	 * @param ctx - The injector context
	 * @returns Messages to prepend when resuming, or undefined
	 */
	injectResumeContext(ctx: InjectorContext): CheckpointMessage[] | undefined;
}
