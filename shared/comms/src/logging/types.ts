/**
 * Minimal logger interface for the comms package.
 *
 * This interface is intentionally minimal to avoid coupling the comms package
 * to any specific logging implementation. Consumers can pass in their own
 * logger that implements this interface.
 */

/**
 * Logger interface for structured logging.
 */
export interface Logger {
	/**
	 * Log a debug message.
	 */
	debug(msg: string): void;
	debug(obj: Record<string, unknown>, msg: string): void;

	/**
	 * Log an info message.
	 */
	info(msg: string): void;
	info(obj: Record<string, unknown>, msg: string): void;

	/**
	 * Log a warning message.
	 */
	warn(msg: string): void;
	warn(obj: Record<string, unknown>, msg: string): void;

	/**
	 * Log an error message.
	 */
	error(msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;

	/**
	 * Create a child logger with additional context.
	 */
	child(bindings: Record<string, unknown>): Logger;
}

/**
 * No-op logger that discards all messages.
 * Used as a default when no logger is provided.
 */
export const noopLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	child: () => noopLogger,
};
