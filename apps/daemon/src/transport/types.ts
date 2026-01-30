/**
 * Transport layer interfaces for client-daemon communication.
 *
 * The transport layer abstracts the underlying communication mechanism
 * (Unix sockets, named pipes, etc.) from the RPC protocol.
 */

// =============================================================================
// RPC Message Types
// =============================================================================

/**
 * RPC request message.
 */
export interface RpcRequest {
	/** Unique request ID */
	readonly id: string;
	/** Method name to invoke */
	readonly method: string;
	/** Optional parameters */
	readonly params?: unknown;
}

/**
 * RPC response message.
 */
export interface RpcResponse {
	/** Request ID this response corresponds to */
	readonly id: string;
	/** Result on success */
	readonly result?: unknown;
	/** Error on failure */
	readonly error?: RpcError;
}

/**
 * RPC notification (no response expected).
 */
export interface RpcNotification {
	/** Notification method name */
	readonly method: string;
	/** Optional parameters */
	readonly params?: unknown;
}

/**
 * RPC error object.
 */
export interface RpcError {
	/** Error code */
	readonly code: number;
	/** Error message */
	readonly message: string;
	/** Optional additional data */
	readonly data?: unknown;
}

// =============================================================================
// Disposable
// =============================================================================

/**
 * A disposable resource that can be cleaned up.
 */
export interface Disposable {
	/** Dispose of the resource */
	dispose(): void;
}

// =============================================================================
// Transport Connection (Server-side)
// =============================================================================

/**
 * A transport connection represents a single client connection.
 */
export interface TransportConnection {
	/** Unique ID for this connection */
	readonly id: string;

	/** Arbitrary metadata about the connection */
	readonly metadata: Record<string, unknown>;

	/**
	 * Send a notification to the client.
	 *
	 * @param notification - The notification to send
	 */
	notify(notification: RpcNotification): void;

	/**
	 * Close the connection.
	 */
	close(): void;
}

// =============================================================================
// Transport Server (Server-side)
// =============================================================================

/**
 * Request handler function type.
 */
export type RequestHandler = (request: RpcRequest, connection: TransportConnection) => Promise<unknown>;

/**
 * A transport server accepts incoming connections.
 */
export interface TransportServer {
	/**
	 * Start listening for connections.
	 */
	listen(): Promise<void>;

	/**
	 * Stop the server and close all connections.
	 */
	close(): Promise<void>;

	/**
	 * Register a request handler.
	 *
	 * @param handler - Called when a request is received
	 * @returns Disposable to remove the handler
	 */
	onRequest(handler: RequestHandler): Disposable;

	/**
	 * Broadcast a notification to all connected clients.
	 *
	 * @param notification - The notification to broadcast
	 */
	broadcast(notification: RpcNotification): void;

	/**
	 * Get the number of active connections.
	 */
	readonly connectionCount: number;
}

// =============================================================================
// Transport Client (Client-side)
// =============================================================================

/**
 * A transport client connects to a server.
 */
export interface TransportClient {
	/**
	 * Connect to the server.
	 */
	connect(): Promise<void>;

	/**
	 * Disconnect from the server.
	 */
	disconnect(): Promise<void>;

	/**
	 * Send a request to the server and wait for a response.
	 *
	 * @param method - The method to call
	 * @param params - Optional parameters
	 * @returns The result from the server
	 */
	request<T = unknown>(method: string, params?: unknown): Promise<T>;

	/**
	 * Subscribe to notifications from the server.
	 *
	 * @param handler - Called when a notification is received
	 * @returns Disposable to remove the handler
	 */
	onNotification(handler: (notification: RpcNotification) => void): Disposable;

	/**
	 * Check if connected.
	 */
	readonly connected: boolean;
}

// =============================================================================
// Transport Registry
// =============================================================================

/**
 * Supported transport types.
 */
export type TransportType = 'socket' | 'stdio' | string;

/**
 * Options for creating a transport server.
 */
export interface TransportServerOptions {
	/** Path for socket-based transports */
	socketPath?: string;
	/** Request timeout in milliseconds */
	requestTimeoutMs?: number;
	/** Additional transport-specific options */
	[key: string]: unknown;
}

/**
 * Options for creating a transport client.
 */
export interface TransportClientOptions {
	/** Path for socket-based transports */
	socketPath?: string;
	/** Connection timeout in milliseconds */
	connectTimeoutMs?: number;
	/** Request timeout in milliseconds */
	requestTimeoutMs?: number;
	/** Additional transport-specific options */
	[key: string]: unknown;
}

/**
 * Factory function for creating transport servers.
 */
export type TransportServerFactory = (options?: TransportServerOptions) => TransportServer;

/**
 * Factory function for creating transport clients.
 */
export type TransportClientFactory = (options?: TransportClientOptions) => TransportClient;

/**
 * Registry for pluggable transport implementations.
 */
export interface TransportRegistry {
	/**
	 * Register a server factory for a transport type.
	 *
	 * @param type - The transport type
	 * @param factory - Factory function to create servers
	 */
	registerServer(type: TransportType, factory: TransportServerFactory): void;

	/**
	 * Register a client factory for a transport type.
	 *
	 * @param type - The transport type
	 * @param factory - Factory function to create clients
	 */
	registerClient(type: TransportType, factory: TransportClientFactory): void;

	/**
	 * Create a transport server.
	 *
	 * @param type - The transport type
	 * @param options - Server options
	 * @returns A new transport server instance
	 */
	createServer(type: TransportType, options?: TransportServerOptions): TransportServer;

	/**
	 * Create a transport client.
	 *
	 * @param type - The transport type
	 * @param options - Client options
	 * @returns A new transport client instance
	 */
	createClient(type: TransportType, options?: TransportClientOptions): TransportClient;
}
