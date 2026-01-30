/**
 * RPC server for handling client connections and method calls.
 *
 * The RPC server provides:
 * - Transport layer abstraction
 * - Request routing to handlers
 * - Subscription notification dispatch
 * - Connection lifecycle management
 */

import type { Logger } from '../logging/logger';
import { MethodNotFoundError } from '../transport/errors';
import type { Disposable, RpcRequest, TransportConnection, TransportServer } from '../transport/types';
import type { RpcHandlerContext, RpcMethodHandler } from './handlers';
import type { RpcMethodName } from './methods';
import type { SubscriptionManager } from './subscriptions';

// =============================================================================
// RPC Error Codes
// =============================================================================

/**
 * Standard RPC error codes.
 */
export const RPC_ERROR_CODES = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
} as const;

// =============================================================================
// RPC Server Types
// =============================================================================

/**
 * Configuration for creating an RPC server.
 */
export interface RpcServerConfig {
	/** Transport server for handling connections */
	transport: TransportServer;
	/** Base handler context (without connection) */
	handlerContext: Omit<RpcHandlerContext, 'connection'>;
	/** Method handlers */
	handlers: Map<RpcMethodName, RpcMethodHandler>;
	/** Subscription manager for handling subscriptions */
	subscriptionManager: SubscriptionManager;
	/** Logger instance */
	logger: Logger;
}

/**
 * RPC Server interface.
 */
export interface RpcServer {
	/**
	 * Start the RPC server.
	 */
	start(): Promise<void>;

	/**
	 * Stop the RPC server.
	 */
	stop(): Promise<void>;

	/**
	 * Check if the server is running.
	 */
	readonly running: boolean;

	/**
	 * Get the number of active connections.
	 */
	readonly connectionCount: number;
}

// =============================================================================
// RPC Server Implementation
// =============================================================================

/**
 * Implementation of the RPC server.
 */
class RpcServerImpl implements RpcServer {
	private readonly _transport: TransportServer;
	private readonly _handlerContext: Omit<RpcHandlerContext, 'connection'>;
	private readonly _handlers: Map<RpcMethodName, RpcMethodHandler>;
	private readonly _subscriptionManager: SubscriptionManager;
	private readonly _logger: Logger;

	private _running = false;
	private _requestHandlerDisposable: Disposable | null = null;
	private readonly _connections: Map<string, TransportConnection> = new Map();

	constructor(config: RpcServerConfig) {
		this._transport = config.transport;
		this._handlerContext = config.handlerContext;
		this._handlers = config.handlers;
		this._subscriptionManager = config.subscriptionManager;
		this._logger = config.logger.child({ component: 'RpcServer' });
	}

	async start(): Promise<void> {
		if (this._running) {
			this._logger.warn('RPC server is already running');
			return;
		}

		this._logger.info('Starting RPC server');

		// Register request handler with transport
		this._requestHandlerDisposable = this._transport.onRequest(async (request, connection) => {
			return this._handleRequest(request, connection);
		});

		// Start the transport
		await this._transport.listen();

		this._running = true;
		this._logger.info('RPC server started');
	}

	async stop(): Promise<void> {
		if (!this._running) {
			this._logger.warn('RPC server is not running');
			return;
		}

		this._logger.info('Stopping RPC server');

		// Clean up all connection subscriptions
		for (const connectionId of this._connections.keys()) {
			this._subscriptionManager.cleanup(connectionId);
		}
		this._connections.clear();

		// Remove request handler
		if (this._requestHandlerDisposable) {
			this._requestHandlerDisposable.dispose();
			this._requestHandlerDisposable = null;
		}

		// Close the transport
		await this._transport.close();

		this._running = false;
		this._logger.info('RPC server stopped');
	}

	get running(): boolean {
		return this._running;
	}

	get connectionCount(): number {
		return this._transport.connectionCount;
	}

	/**
	 * Handle an incoming RPC request.
	 */
	private async _handleRequest(request: RpcRequest, connection: TransportConnection): Promise<unknown> {
		const { method, id, params } = request;

		// Track connection for cleanup
		if (!this._connections.has(connection.id)) {
			this._connections.set(connection.id, connection);
			this._logger.debug({ connectionId: connection.id }, 'New connection registered');
		}

		this._logger.debug({ method, requestId: id, connectionId: connection.id }, 'Handling request');

		// Look up the handler
		const handler = this._handlers.get(method as RpcMethodName);
		if (!handler) {
			this._logger.warn({ method }, 'Method not found');
			throw new MethodNotFoundError(method);
		}

		// Create the full context with this connection
		const context: RpcHandlerContext = {
			...this._handlerContext,
			connection,
		};

		try {
			// Execute the handler
			const result = await handler(params ?? {}, context);
			this._logger.debug({ method, requestId: id }, 'Request completed successfully');
			return result;
		} catch (error) {
			this._logger.error({ error, method, requestId: id }, 'Handler error');
			throw error;
		}
	}

	/**
	 * Get a connection by ID.
	 * Used by subscription manager to send notifications.
	 */
	getConnection(connectionId: string): TransportConnection | undefined {
		return this._connections.get(connectionId);
	}

	/**
	 * Called when a connection is closed.
	 * Cleans up subscriptions for the connection.
	 */
	handleConnectionClosed(connectionId: string): void {
		this._connections.delete(connectionId);
		this._subscriptionManager.cleanup(connectionId);
		this._logger.debug({ connectionId }, 'Connection cleaned up');
	}
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new RPC server.
 *
 * @param config - Server configuration
 * @returns A new RpcServer instance
 */
export function createRpcServer(config: RpcServerConfig): RpcServer {
	return new RpcServerImpl(config);
}

// =============================================================================
// Legacy Exports (for backward compatibility)
// =============================================================================

/**
 * RPC request from a client.
 * @deprecated Use RpcRequest from transport/types instead
 */
export interface LegacyRpcRequest {
	/** JSON-RPC version (always "2.0") */
	jsonrpc: '2.0';
	/** Request ID for correlating response */
	id: string | number;
	/** Method name to call */
	method: RpcMethodName;
	/** Method parameters */
	params?: unknown;
}

/**
 * RPC response to a client.
 * @deprecated Use RpcResponse from transport/types instead
 */
export interface LegacyRpcResponse {
	/** JSON-RPC version (always "2.0") */
	jsonrpc: '2.0';
	/** Request ID this is responding to */
	id: string | number;
	/** Result on success */
	result?: unknown;
	/** Error on failure */
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}
