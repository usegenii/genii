/**
 * Result of truncating output.
 */
export interface TruncateResult {
	/** The truncated (or original) text */
	text: string;
	/** Whether truncation occurred */
	truncated: boolean;
}

/**
 * Truncate output to the last maxLength characters, breaking on line boundaries.
 *
 * This function keeps the most recent output (end of the string) rather than the
 * beginning, which is typically more useful for command output. It breaks on line
 * boundaries to avoid partial lines at the start of the truncated output.
 *
 * @param output - The output string to truncate
 * @param maxLength - Maximum length in characters
 * @returns The truncated result with text and truncation status
 */
export function truncateOutput(output: string, maxLength: number): TruncateResult {
	if (output.length <= maxLength) {
		return { text: output, truncated: false };
	}

	// Take last maxLength chars
	const truncated = output.slice(-maxLength);

	// Find first newline to avoid partial line at start
	const firstNewline = truncated.indexOf('\n');

	if (firstNewline === -1) {
		// Single long line - return as-is (edge case)
		return { text: truncated, truncated: true };
	}

	// Start after the first newline (skip partial line)
	return { text: truncated.slice(firstNewline + 1), truncated: true };
}
