/**
 * Unix socket transport server implementation.
 *
 * Provides a Unix socket (or Windows named pipe) server
 * that implements the TransportServer interface.
 */

import type { Logger } from '../../logging/logger';
import { createFramedHandler, encode } from '../codec';
import { RpcException } from '../errors';
import type {
	Disposable,
	RequestHandler,
	RpcNotification,
	RpcRequest,
	RpcResponse,
	TransportConnection,
	TransportServer,
} from '../types';

/**
 * Configuration for the socket server.
 */
export interface SocketServerConfig {
	/** Path to the Unix socket */
	socketPath: string;
	/** Backlog for pending connections */
	backlog?: number;
	/** Request timeout in milliseconds */
	requestTimeoutMs?: number;
}

/**
 * Internal connection implementation for socket connections.
 */
class SocketConnection implements TransportConnection {
	readonly id: string;
	readonly metadata: Record<string, unknown>;

	private readonly _socket: import('node:net').Socket;
	private _closed = false;

	constructor(id: string, socket: import('node:net').Socket) {
		this.id = id;
		this._socket = socket;
		this.metadata = {
			remoteAddress: socket.remoteAddress,
			connectedAt: Date.now(),
		};
	}

	notify(notification: RpcNotification): void {
		if (this._closed) {
			return;
		}
		const data = encode(notification);
		this._socket.write(data);
	}

	close(): void {
		if (this._closed) {
			return;
		}
		this._closed = true;
		this._socket.end();
	}

	/**
	 * Send a response to the client.
	 */
	sendResponse(response: RpcResponse): void {
		if (this._closed) {
			return;
		}
		const data = encode(response);
		this._socket.write(data);
	}

	get socket(): import('node:net').Socket {
		return this._socket;
	}

	get isClosed(): boolean {
		return this._closed;
	}

	markClosed(): void {
		this._closed = true;
	}
}

/**
 * SocketTransportServer implements TransportServer using Unix sockets.
 */
export class SocketTransportServer implements TransportServer {
	private readonly _config: SocketServerConfig;
	private readonly _logger: Logger;
	private readonly _requestHandlers: Set<RequestHandler> = new Set();
	private readonly _connections: Map<string, SocketConnection> = new Map();

	private _server: import('node:net').Server | null = null;
	private _listening = false;
	private _nextConnectionId = 1;

	constructor(config: SocketServerConfig, logger: Logger) {
		this._config = config;
		this._logger = logger;
	}

	/**
	 * Start listening for connections.
	 *
	 * Creates the Unix socket and begins accepting connections.
	 */
	async listen(): Promise<void> {
		if (this._listening) {
			return;
		}

		const net = await import('node:net');
		const fs = await import('node:fs/promises');

		// Remove existing socket file if present
		try {
			await fs.unlink(this._config.socketPath);
		} catch {
			// Ignore if file doesn't exist
		}

		this._server = net.createServer((socket) => this._handleConnection(socket));

		return new Promise((resolve, reject) => {
			if (!this._server) {
				reject(new Error('Server not initialized'));
				return;
			}

			this._server.on('error', (err) => {
				this._logger.error({ err }, 'Socket server error');
				if (!this._listening) {
					reject(err);
				}
			});

			this._server.listen(
				{
					path: this._config.socketPath,
					backlog: this._config.backlog,
				},
				() => {
					this._listening = true;
					this._logger.info({ socketPath: this._config.socketPath }, 'Socket server listening');
					resolve();
				},
			);
		});
	}

	/**
	 * Stop the server and close all connections.
	 */
	async close(): Promise<void> {
		if (!this._listening) {
			return;
		}

		this._listening = false;

		// Close all connections
		for (const connection of this._connections.values()) {
			connection.close();
		}
		this._connections.clear();

		// Close server
		if (this._server) {
			await new Promise<void>((resolve) => {
				this._server?.close(() => resolve());
			});
			this._server = null;
		}

		// Remove socket file
		try {
			const fs = await import('node:fs/promises');
			await fs.unlink(this._config.socketPath);
		} catch {
			// Ignore if file doesn't exist
		}

		this._logger.info('Socket server stopped');
	}

	/**
	 * Register a request handler.
	 *
	 * @param handler - Called when a request is received
	 * @returns Disposable to remove the handler
	 */
	onRequest(handler: RequestHandler): Disposable {
		this._requestHandlers.add(handler);
		return {
			dispose: () => {
				this._requestHandlers.delete(handler);
			},
		};
	}

	/**
	 * Broadcast a notification to all connected clients.
	 *
	 * @param notification - The notification to broadcast
	 */
	broadcast(notification: RpcNotification): void {
		for (const connection of this._connections.values()) {
			try {
				connection.notify(notification);
			} catch (err) {
				this._logger.warn({ err, connectionId: connection.id }, 'Failed to broadcast to connection');
			}
		}
	}

	/**
	 * Get the number of active connections.
	 */
	get connectionCount(): number {
		return this._connections.size;
	}

	/**
	 * Check if the server is listening.
	 */
	get listening(): boolean {
		return this._listening;
	}

	/**
	 * Get the socket path.
	 */
	get socketPath(): string {
		return this._config.socketPath;
	}

	/**
	 * Handle a new socket connection.
	 */
	private _handleConnection(socket: import('node:net').Socket): void {
		const connectionId = `conn-${this._nextConnectionId++}`;
		const connection = new SocketConnection(connectionId, socket);
		this._connections.set(connectionId, connection);

		this._logger.debug({ connectionId }, 'New connection');

		// Set up message decoding
		const handleMessage = createFramedHandler((message: unknown) => {
			this._handleMessage(message, connection);
		});

		socket.on('data', (data: Buffer) => {
			handleMessage(data);
		});

		socket.on('close', () => {
			connection.markClosed();
			this._connections.delete(connectionId);
			this._logger.debug({ connectionId }, 'Connection closed');
		});

		socket.on('error', (err) => {
			this._logger.warn({ err, connectionId }, 'Connection error');
		});
	}

	/**
	 * Handle an incoming message.
	 */
	private async _handleMessage(message: unknown, connection: SocketConnection): Promise<void> {
		// Validate it's a request
		if (!this._isRpcRequest(message)) {
			this._logger.warn({ message }, 'Invalid RPC message');
			return;
		}

		const request = message as RpcRequest;
		this._logger.debug({ method: request.method, id: request.id }, 'Received request');

		// Call all handlers
		let result: unknown;
		let error: RpcException | null = null;

		for (const handler of this._requestHandlers) {
			try {
				result = await handler(request, connection);
				break; // First handler that returns a result wins
			} catch (err) {
				error = RpcException.fromError(err);
				break;
			}
		}

		// Send response
		const response: RpcResponse = {
			id: request.id,
			...(error ? { error: error.toJSON() } : { result }),
		};

		connection.sendResponse(response);
	}

	/**
	 * Check if a message is a valid RPC request.
	 */
	private _isRpcRequest(message: unknown): message is RpcRequest {
		if (typeof message !== 'object' || message === null) {
			return false;
		}
		const obj = message as Record<string, unknown>;
		return typeof obj.id === 'string' && typeof obj.method === 'string';
	}
}
