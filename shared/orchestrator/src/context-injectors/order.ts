/**
 * Context injector ordering constants.
 *
 * Injectors are sorted by their order value before collecting context.
 * Lower order values are processed first.
 */

export const INJECTOR_ORDER = {
	/** Soul content (SOUL.md) - identity and core personality */
	SOUL: 0,
	/** Identity files (IDENTITY.md, HUMAN.md) - formed identity and human info */
	IDENTITY: 50,
	/** Instructions (INSTRUCTIONS.md) - behavioral guidelines */
	INSTRUCTIONS: 100,
	/** Skills section - available skill bundles */
	SKILLS: 200,
	/** Memories path - where to find persistent memories */
	MEMORIES_PATH: 250,
	/** DateTime context - current date and time */
	DATETIME: 300,
	/** Tasks section - available task documents */
	TASKS: 400,
	/** Pulse context - scheduled session instructions (after tasks) */
	PULSE: 500,
} as const;

export type InjectorOrderKey = keyof typeof INJECTOR_ORDER;
