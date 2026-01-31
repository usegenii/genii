/**
 * Pulse context injector implementation.
 *
 * Injects PULSE.md content and response instructions for scheduled pulse sessions.
 * Only activates when ctx.metadata?.isPulse is true.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CheckpointMessage } from '../../snapshot/types';
import { INJECTOR_ORDER } from '../order';
import type { ContextInjector, InjectorContext } from '../types';

/**
 * Instructions when a response destination is configured.
 */
const RESPONSE_ENABLED_INSTRUCTIONS = `---
This is a scheduled pulse session. If you have something to communicate, respond normally.
If no response is needed, output: <rest />
---`;

/**
 * Instructions when running in silent mode (no destination).
 */
const SILENT_MODE_INSTRUCTIONS = `---
This is a scheduled pulse session running in silent mode.
Your response will not be delivered. Focus on any tasks or reflection needed.
---`;

/**
 * Pulse context injector.
 *
 * This injector activates only for pulse sessions (ctx.metadata?.isPulse === true)
 * and injects:
 * 1. The contents of PULSE.md from the configured path or guidance directory
 * 2. Conditional response instructions based on whether a destination is configured
 */
export class PulseContextInjector implements ContextInjector {
	readonly name = 'pulse';
	readonly order = INJECTOR_ORDER.PULSE;

	/**
	 * Inject system context with pulse prompt and response instructions.
	 * @param ctx - The injector context
	 * @returns System context string with PULSE.md content and instructions, or undefined if not a pulse session
	 */
	async injectSystemContext(ctx: InjectorContext): Promise<string | undefined> {
		// Only activate for pulse sessions
		if (!ctx.metadata?.isPulse) {
			return undefined;
		}

		// Determine the path to PULSE.md
		const promptPath =
			(ctx.metadata.pulsePromptPath as string | undefined) ??
			(ctx.guidancePath ? join(ctx.guidancePath, 'PULSE.md') : undefined);

		if (!promptPath) {
			// No path available, just inject instructions
			const instructions = ctx.metadata.hasResponseDestination
				? RESPONSE_ENABLED_INSTRUCTIONS
				: SILENT_MODE_INSTRUCTIONS;
			return instructions;
		}

		// Try to read PULSE.md
		let pulseContent = '';
		try {
			pulseContent = await readFile(promptPath, 'utf-8');
		} catch {
			// File doesn't exist or can't be read, continue without it
		}

		// Add conditional response instructions
		const instructions = ctx.metadata.hasResponseDestination
			? RESPONSE_ENABLED_INSTRUCTIONS
			: SILENT_MODE_INSTRUCTIONS;

		if (pulseContent) {
			return `${pulseContent}\n\n${instructions}`;
		}

		return instructions;
	}

	/**
	 * Pulse injector does not inject resume context.
	 */
	injectResumeContext(_ctx: InjectorContext): CheckpointMessage[] | undefined {
		return undefined;
	}
}
