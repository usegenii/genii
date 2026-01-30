/**
 * Error handling utilities for the CLI.
 * @module utils/errors
 */

/**
 * Base CLI error class.
 */
export class CliError extends Error {
	/** Error code for programmatic handling */
	code: string;
	/** Exit code for process exit */
	exitCode: number;

	constructor(message: string, code: string, exitCode = 1) {
		super(message);
		this.name = 'CliError';
		this.code = code;
		this.exitCode = exitCode;
	}
}

/**
 * Error when daemon is not running or unreachable.
 */
export class DaemonNotRunningError extends CliError {
	constructor(message = 'Daemon is not running. Start it with: genii daemon start') {
		super(message, 'DAEMON_NOT_RUNNING', 2);
		this.name = 'DaemonNotRunningError';
	}
}

/**
 * Error when connection to daemon times out.
 */
export class ConnectionTimeoutError extends CliError {
	constructor(message = 'Connection to daemon timed out') {
		super(message, 'CONNECTION_TIMEOUT', 3);
		this.name = 'ConnectionTimeoutError';
	}
}

/**
 * Error when a resource is not found.
 */
export class NotFoundError extends CliError {
	/** Type of resource that was not found */
	resourceType: string;
	/** ID of the resource that was not found */
	resourceId: string;

	constructor(resourceType: string, resourceId: string) {
		super(`${resourceType} not found: ${resourceId}`, 'NOT_FOUND', 4);
		this.name = 'NotFoundError';
		this.resourceType = resourceType;
		this.resourceId = resourceId;
	}
}

/**
 * Error when an operation is invalid.
 */
export class InvalidOperationError extends CliError {
	constructor(message: string) {
		super(message, 'INVALID_OPERATION', 5);
		this.name = 'InvalidOperationError';
	}
}

/**
 * Error when configuration is invalid.
 */
export class ConfigurationError extends CliError {
	constructor(message: string) {
		super(message, 'CONFIGURATION_ERROR', 6);
		this.name = 'ConfigurationError';
	}
}

/**
 * Handle an error and format it for output.
 * @param error - The error to handle
 * @returns Formatted error information
 */
export function handleError(error: unknown): { message: string; code: string; exitCode: number } {
	if (error instanceof CliError) {
		return {
			message: error.message,
			code: error.code,
			exitCode: error.exitCode,
		};
	}

	if (error instanceof Error) {
		return {
			message: error.message,
			code: 'UNKNOWN_ERROR',
			exitCode: 1,
		};
	}

	return {
		message: String(error),
		code: 'UNKNOWN_ERROR',
		exitCode: 1,
	};
}

/**
 * Exit the process with an error.
 * @param error - The error to exit with
 */
export function exitWithError(error: unknown): never {
	const { message, exitCode } = handleError(error);
	console.error(`Error: ${message}`);
	process.exit(exitCode);
}
