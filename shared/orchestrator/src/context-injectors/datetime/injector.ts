/**
 * DateTime context injector implementation.
 *
 * Injects current date/time into agent context for time-aware responses.
 */

import type { CheckpointMessage } from '../../snapshot/types';
import { INJECTOR_ORDER } from '../order';
import type { ContextInjector, InjectorContext } from '../types';
import { formatDateTime } from './format';

/**
 * DateTime context injector.
 *
 * This injector provides the current date and time in the agent's system context
 * for new sessions, and an updated timestamp message when resuming sessions.
 */
export class DateTimeContextInjector implements ContextInjector {
	readonly name = 'datetime';
	readonly order = INJECTOR_ORDER.DATETIME;

	/**
	 * Inject system context with the current date and time.
	 * @param ctx - The injector context
	 * @returns System context string with formatted datetime
	 */
	injectSystemContext(ctx: InjectorContext): string {
		const formatted = formatDateTime(ctx.now, ctx.timezone);
		return `<system-context>Current date and time: ${formatted}</system-context>`;
	}

	/**
	 * Inject resume message with the current date and time.
	 * @param ctx - The injector context
	 * @returns Array with a single user message containing the datetime update
	 */
	injectResumeContext(ctx: InjectorContext): CheckpointMessage[] {
		const formatted = formatDateTime(ctx.now, ctx.timezone);
		return [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: `<context-update type="datetime">The current date and time is ${formatted}</context-update>`,
					},
				],
				timestamp: ctx.now.getTime(),
			},
		];
	}
}

/**
 * Create a DateTime context injector.
 *
 * @returns A ContextInjector for datetime context
 * @deprecated Use `new DateTimeContextInjector()` instead
 */
export function createDateTimeContextInjector(): ContextInjector {
	return new DateTimeContextInjector();
}
