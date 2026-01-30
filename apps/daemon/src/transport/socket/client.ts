/**
 * Unix socket transport client implementation.
 *
 * Provides a Unix socket (or Windows named pipe) client
 * that implements the TransportClient interface.
 */

import type { Logger } from '../../logging/logger';
import { createFramedHandler, encode } from '../codec';
import { NotConnectedError, RequestTimeoutError } from '../errors';
import type { Disposable, RpcNotification, RpcRequest, RpcResponse, TransportClient } from '../types';

/**
 * Configuration for the socket client.
 */
export interface SocketClientConfig {
	/** Path to the Unix socket to connect to */
	socketPath: string;
	/** Connection timeout in milliseconds */
	connectTimeoutMs?: number;
	/** Request timeout in milliseconds */
	requestTimeoutMs?: number;
	/** Reconnection configuration */
	reconnect?: {
		/** Whether to automatically reconnect */
		enabled: boolean;
		/** Maximum number of reconnect attempts */
		maxAttempts?: number;
		/** Base delay between reconnect attempts in milliseconds */
		delayMs?: number;
	};
}

/**
 * Default client configuration.
 */
const DEFAULT_CONFIG = {
	connectTimeoutMs: 5000,
	requestTimeoutMs: 30000,
	reconnect: {
		enabled: true,
		maxAttempts: 5,
		delayMs: 1000,
	},
} as const;

/**
 * Pending request tracker.
 */
interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

/**
 * SocketTransportClient implements TransportClient using Unix sockets.
 */
export class SocketTransportClient implements TransportClient {
	private readonly _config: Required<SocketClientConfig>;
	private readonly _logger: Logger;
	private readonly _notificationHandlers: Set<(notification: RpcNotification) => void> = new Set();
	private readonly _pendingRequests: Map<string, PendingRequest> = new Map();

	private _socket: import('node:net').Socket | null = null;
	private _connected = false;
	private _nextRequestId = 1;

	constructor(config: SocketClientConfig, logger: Logger) {
		this._config = {
			...DEFAULT_CONFIG,
			...config,
			reconnect: {
				...DEFAULT_CONFIG.reconnect,
				...config.reconnect,
			},
		};
		this._logger = logger;
	}

	/**
	 * Connect to the server.
	 */
	async connect(): Promise<void> {
		if (this._connected) {
			return;
		}

		const net = await import('node:net');

		return new Promise((resolve, reject) => {
			const socket = net.createConnection(this._config.socketPath);
			this._socket = socket;

			// Set up connection timeout
			const connectTimeout = setTimeout(() => {
				socket.destroy();
				reject(new Error(`Connection timeout after ${this._config.connectTimeoutMs}ms`));
			}, this._config.connectTimeoutMs);

			socket.on('connect', () => {
				clearTimeout(connectTimeout);
				this._connected = true;
				this._logger.debug({ socketPath: this._config.socketPath }, 'Connected to socket');
				resolve();
			});

			socket.on('error', (err) => {
				clearTimeout(connectTimeout);
				if (!this._connected) {
					reject(err);
				} else {
					this._logger.warn({ err }, 'Socket error');
				}
			});

			// Set up message handling
			const handleMessage = createFramedHandler((message: unknown) => {
				this._handleMessage(message);
			});

			socket.on('data', (data: Buffer) => {
				handleMessage(data);
			});

			socket.on('close', () => {
				this._connected = false;
				this._socket = null;

				// Reject all pending requests
				for (const [id, pending] of this._pendingRequests) {
					clearTimeout(pending.timeout);
					pending.reject(new NotConnectedError('Connection closed'));
					this._pendingRequests.delete(id);
				}

				this._logger.debug('Socket closed');
			});
		});
	}

	/**
	 * Disconnect from the server.
	 */
	async disconnect(): Promise<void> {
		if (!this._connected || !this._socket) {
			return;
		}

		this._connected = false;

		return new Promise((resolve) => {
			if (this._socket) {
				this._socket.once('close', () => {
					this._socket = null;
					resolve();
				});
				this._socket.end();
			} else {
				resolve();
			}
		});
	}

	/**
	 * Send a request to the server and wait for a response.
	 *
	 * @param method - The method to call
	 * @param params - Optional parameters
	 * @returns The result from the server
	 */
	async request<T = unknown>(method: string, params?: unknown): Promise<T> {
		if (!this._connected || !this._socket) {
			throw new NotConnectedError();
		}

		const id = `req-${this._nextRequestId++}`;
		const request: RpcRequest = { id, method, params };

		return new Promise((resolve, reject) => {
			// Set up timeout
			const timeout = setTimeout(() => {
				this._pendingRequests.delete(id);
				reject(new RequestTimeoutError(id, this._config.requestTimeoutMs));
			}, this._config.requestTimeoutMs);

			// Store pending request
			this._pendingRequests.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeout,
			});

			// Send request
			const data = encode(request);
			this._socket?.write(data);

			this._logger.debug({ method, id }, 'Sent request');
		});
	}

	/**
	 * Subscribe to notifications from the server.
	 *
	 * @param handler - Called when a notification is received
	 * @returns Disposable to remove the handler
	 */
	onNotification(handler: (notification: RpcNotification) => void): Disposable {
		this._notificationHandlers.add(handler);
		return {
			dispose: () => {
				this._notificationHandlers.delete(handler);
			},
		};
	}

	/**
	 * Check if connected.
	 */
	get connected(): boolean {
		return this._connected;
	}

	/**
	 * Get the socket path.
	 */
	get socketPath(): string {
		return this._config.socketPath;
	}

	/**
	 * Handle an incoming message.
	 */
	private _handleMessage(message: unknown): void {
		if (typeof message !== 'object' || message === null) {
			this._logger.warn({ message }, 'Invalid message received');
			return;
		}

		const obj = message as Record<string, unknown>;

		// Check if it's a response (has id)
		if ('id' in obj && typeof obj.id === 'string') {
			this._handleResponse(obj as unknown as RpcResponse);
		}
		// Check if it's a notification (has method but no id)
		else if ('method' in obj && typeof obj.method === 'string') {
			this._handleNotification(obj as unknown as RpcNotification);
		} else {
			this._logger.warn({ message }, 'Unknown message type');
		}
	}

	/**
	 * Handle a response message.
	 */
	private _handleResponse(response: RpcResponse): void {
		const pending = this._pendingRequests.get(response.id);
		if (!pending) {
			this._logger.warn({ id: response.id }, 'Received response for unknown request');
			return;
		}

		this._pendingRequests.delete(response.id);
		clearTimeout(pending.timeout);

		if (response.error) {
			const error = new Error(response.error.message);
			(error as Error & { code?: number }).code = response.error.code;
			pending.reject(error);
		} else {
			pending.resolve(response.result);
		}
	}

	/**
	 * Handle a notification message.
	 */
	private _handleNotification(notification: RpcNotification): void {
		this._logger.debug({ method: notification.method }, 'Received notification');

		for (const handler of this._notificationHandlers) {
			try {
				handler(notification);
			} catch (err) {
				this._logger.warn({ err, method: notification.method }, 'Notification handler error');
			}
		}
	}
}
