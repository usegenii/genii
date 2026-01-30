/**
 * RPC exception types for transport layer errors.
 *
 * Standard JSON-RPC 2.0 error codes:
 * - -32700: Parse error
 * - -32600: Invalid Request
 * - -32601: Method not found
 * - -32602: Invalid params
 * - -32603: Internal error
 * - -32000 to -32099: Server error (reserved for implementation-defined errors)
 */

// =============================================================================
// Standard JSON-RPC Error Codes
// =============================================================================

/**
 * Standard JSON-RPC 2.0 error codes.
 */
export const RpcErrorCode = {
	/** Invalid JSON was received by the server */
	ParseError: -32700,
	/** The JSON sent is not a valid Request object */
	InvalidRequest: -32600,
	/** The method does not exist / is not available */
	MethodNotFound: -32601,
	/** Invalid method parameter(s) */
	InvalidParams: -32602,
	/** Internal JSON-RPC error */
	InternalError: -32603,
	/** Reserved for implementation-defined server-errors (min) */
	ServerErrorMin: -32099,
	/** Reserved for implementation-defined server-errors (max) */
	ServerErrorMax: -32000,
} as const;

// =============================================================================
// RPC Exceptions
// =============================================================================

/**
 * Base class for RPC errors.
 */
export class RpcException extends Error {
	readonly code: number;
	readonly data?: unknown;

	constructor(code: number, message: string, data?: unknown) {
		super(message);
		this.name = 'RpcException';
		this.code = code;
		this.data = data;
	}

	/**
	 * Convert to JSON-RPC error object.
	 */
	toJSON(): { code: number; message: string; data?: unknown } {
		return {
			code: this.code,
			message: this.message,
			...(this.data !== undefined && { data: this.data }),
		};
	}

	/**
	 * Create an RpcException from an unknown error.
	 */
	static fromError(error: unknown): RpcException {
		if (error instanceof RpcException) {
			return error;
		}
		if (error instanceof Error) {
			return new InternalError(error.message, { stack: error.stack });
		}
		return new InternalError(String(error));
	}
}

/**
 * Parse error - invalid JSON was received.
 * Code: -32700
 */
export class ParseError extends RpcException {
	constructor(data?: unknown) {
		super(RpcErrorCode.ParseError, 'Parse error', data);
		this.name = 'ParseError';
	}
}

/**
 * Invalid request - the JSON sent is not a valid request object.
 * Code: -32600
 */
export class InvalidRequestError extends RpcException {
	constructor(data?: unknown) {
		super(RpcErrorCode.InvalidRequest, 'Invalid request', data);
		this.name = 'InvalidRequestError';
	}
}

/**
 * Method not found - the method does not exist.
 * Code: -32601
 */
export class MethodNotFoundError extends RpcException {
	constructor(method: string) {
		super(RpcErrorCode.MethodNotFound, `Method not found: ${method}`);
		this.name = 'MethodNotFoundError';
	}
}

/**
 * Invalid params - invalid method parameters.
 * Code: -32602
 */
export class InvalidParamsError extends RpcException {
	constructor(message?: string, data?: unknown) {
		super(RpcErrorCode.InvalidParams, message ?? 'Invalid params', data);
		this.name = 'InvalidParamsError';
	}
}

/**
 * Internal error - internal JSON-RPC error.
 * Code: -32603
 */
export class InternalError extends RpcException {
	constructor(message?: string, data?: unknown) {
		super(RpcErrorCode.InternalError, message ?? 'Internal error', data);
		this.name = 'InternalError';
	}
}

/**
 * Server error - implementation-defined server error.
 * Code: -32000 to -32099
 */
export class ServerError extends RpcException {
	constructor(code: number, message: string, data?: unknown) {
		// Validate code is in server error range
		if (code < RpcErrorCode.ServerErrorMin || code > RpcErrorCode.ServerErrorMax) {
			throw new Error(
				`Server error code must be between ${RpcErrorCode.ServerErrorMin} and ${RpcErrorCode.ServerErrorMax}`,
			);
		}
		super(code, message, data);
		this.name = 'ServerError';
	}
}

// =============================================================================
// Transport Errors
// =============================================================================

/**
 * Transport error - connection/socket related errors.
 */
export class TransportError extends Error {
	readonly cause?: Error;

	constructor(message: string, cause?: Error) {
		super(message);
		this.name = 'TransportError';
		this.cause = cause;
	}
}

/**
 * Connection error - failed to establish connection.
 */
export class ConnectionError extends TransportError {
	constructor(message: string, cause?: Error) {
		super(message, cause);
		this.name = 'ConnectionError';
	}
}

/**
 * Timeout error - operation timed out.
 */
export class TimeoutError extends TransportError {
	readonly timeoutMs: number;

	constructor(message: string, timeoutMs: number) {
		super(message);
		this.name = 'TimeoutError';
		this.timeoutMs = timeoutMs;
	}
}

/**
 * Request timeout error - request did not receive a response in time.
 */
export class RequestTimeoutError extends TimeoutError {
	readonly requestId: string;

	constructor(requestId: string, timeoutMs: number) {
		super(`Request ${requestId} timed out after ${timeoutMs}ms`, timeoutMs);
		this.name = 'RequestTimeoutError';
		this.requestId = requestId;
	}
}

/**
 * Not connected error - operation requires an active connection.
 */
export class NotConnectedError extends TransportError {
	constructor(message = 'Not connected') {
		super(message);
		this.name = 'NotConnectedError';
	}
}
