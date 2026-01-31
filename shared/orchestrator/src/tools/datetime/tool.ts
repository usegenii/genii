/**
 * DateTime tool for natural language date parsing and calculations.
 *
 * Uses chrono-node to parse natural language date expressions and
 * provides formatted output in the configured timezone.
 */

import { Type } from '@sinclair/typebox';
import * as chrono from 'chrono-node';
import { formatDateTime } from '../../context-injectors/datetime/format.js';
import type { Tool } from '../types.js';

/**
 * Configuration for the datetime tool.
 */
export interface DateTimeToolConfig {
	/** User timezone (e.g., 'America/New_York') */
	timezone: string;
}

/**
 * Input schema for the datetime tool.
 */
const DateTimeToolInputSchema = Type.Object({
	expression: Type.String({
		description: 'Natural language date expression: "next friday", "in 2 weeks", "3 days ago"',
	}),
	from: Type.Optional(
		Type.String({
			description: 'Optional reference date in ISO format. Defaults to now.',
		}),
	),
});

/**
 * Input type for the datetime tool.
 */
type DateTimeToolInput = {
	expression: string;
	from?: string;
};

/**
 * Output type for the datetime tool.
 */
interface DateTimeToolOutput {
	/** ISO 8601 formatted date string */
	iso: string;
	/** Human-readable formatted date string */
	formatted: string;
	/** Unix timestamp in milliseconds */
	unix: number;
}

/**
 * Create a datetime tool with the given configuration.
 *
 * The tool parses natural language date expressions using chrono-node
 * and returns the result in multiple formats.
 *
 * @param config - Tool configuration
 * @returns DateTime tool instance
 */
export function createDateTimeTool(config: DateTimeToolConfig): Tool<DateTimeToolInput, DateTimeToolOutput> {
	const description = `Parse natural language date expressions and perform date calculations.

Examples:
- "next friday" - Returns the date of the next Friday
- "in 2 weeks" - Returns the date 2 weeks from now
- "3 days ago" - Returns the date 3 days in the past
- "tomorrow at 3pm" - Returns tomorrow at 3:00 PM
- "January 15, 2025" - Returns the specified date

The optional 'from' parameter allows specifying a reference date in ISO format.
If not provided, the current date/time is used as the reference.`;

	return {
		name: 'datetime',
		label: 'DateTime',
		description,
		category: 'utility',
		parameters: DateTimeToolInputSchema,

		execute: async (input, context) => {
			const referenceDate = input.from ? new Date(input.from) : new Date();

			// Validate reference date
			if (Number.isNaN(referenceDate.getTime())) {
				return {
					status: 'error',
					error: `Invalid reference date: "${input.from}". Please provide a valid ISO date string.`,
					retryable: false,
				};
			}

			context.log('info', `Parsing date expression: "${input.expression}" from ${referenceDate.toISOString()}`);

			// Parse the expression using chrono-node
			const results = chrono.parse(input.expression, referenceDate);

			if (results.length === 0) {
				return {
					status: 'error',
					error: `Could not parse date expression: "${input.expression}". Try expressions like "next friday", "in 2 weeks", "3 days ago", or "tomorrow at 3pm".`,
					retryable: false,
				};
			}

			// Use the first parsed result
			const parsed = results[0];
			if (!parsed) {
				return {
					status: 'error',
					error: `Could not parse date expression: "${input.expression}". Try expressions like "next friday", "in 2 weeks", "3 days ago", or "tomorrow at 3pm".`,
					retryable: false,
				};
			}
			const parsedDate = parsed.date();

			// Format the output
			const output: DateTimeToolOutput = {
				iso: parsedDate.toISOString(),
				formatted: formatDateTime(parsedDate, config.timezone),
				unix: parsedDate.getTime(),
			};

			return {
				status: 'success',
				output,
			};
		},
	};
}
