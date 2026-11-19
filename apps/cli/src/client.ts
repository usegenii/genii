/**
 * DaemonClient wrapper for communicating with the Genii daemon.
 * Provides a typed interface for all daemon RPC operations.
 * @module client
 */

import type * as net from 'node:net';
import { RpcApplicationErrorCode, type RpcMethodResults, type RpcMethods } from '@genii/lib/rpc/methods';
import type { RpcNotification } from '@genii/lib/rpc/notifications';
import { NotFoundError } from './utils/errors';

// =============================================================================
// Transport Types (copied from daemon for CLI independence)
// =============================================================================

/**
 * RPC request message.
 */
interface RpcRequest {
	readonly id: string;
	readonly method: string;
	readonly params?: unknown;
}

/**
 * RPC response message.
 */
interface RpcResponse {
	readonly id: string;
	readonly result?: unknown;
	readonly error?: RpcError;
}

/**
 * RPC error object.
 */
interface RpcError {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

// =============================================================================
// Domain Types
// =============================================================================

/** Daemon status information returned by the RPC boundary. */
export type DaemonStatus = RpcMethodResults['daemon.status'];

/**
 * Agent summary for listing.
 */
export interface AgentSummary {
	id: string;
	name: string;
	status: 'running' | 'paused' | 'terminated';
	conversationCount: number;
	createdAt: string;
	lastActiveAt: string;
}

/** Existing agent details returned by the RPC boundary. */
export type AgentDetails = NonNullable<RpcMethodResults['agent.get']>;

/** Agent snapshot returned by the RPC boundary. */
export type AgentSnapshot = RpcMethodResults['agent.snapshot'];

/**
 * Options for spawning an agent.
 */
export type SpawnAgentOptions = RpcMethods['agent.spawn'];

/** Channel summary returned by the RPC boundary. */
export type ChannelSummary = RpcMethodResults['channel.list'][number];

/** Existing channel details returned by the RPC boundary. */
export type ChannelDetails = NonNullable<RpcMethodResults['channel.get']>;

/**
 * Filter for listing conversations.
 */
export interface ConversationFilter {
	channelId?: string;
	agentId?: string;
	status?: 'active' | 'closed';
}

/**
 * Conversation summary for listing.
 */
export interface ConversationSummary {
	ref: string;
	channelId: string;
	agentId?: string;
	messageCount: number;
	status: 'active' | 'closed';
	createdAt: string;
	lastMessageAt?: string;
}

/**
 * Conversation details.
 */
export interface ConversationDetails extends ConversationSummary {
	history?: Array<{
		role: string;
		content: string;
		timestamp: string;
	}>;
	metadata: Record<string, unknown>;
}

// =============================================================================
// Onboard Types
// =============================================================================

/**
 * Status of the onboard operation.
 */
export interface OnboardStatus {
	/** Path where guidance files will be copied */
	guidancePath: string;
	/** List of template files available to copy */
	templates: string[];
	/** List of files that already exist and would be overwritten */
	existing: string[];
}

/**
 * Result of the onboard execution.
 */
export interface OnboardResult {
	/** Files that were copied */
	copied: string[];
	/** Files that were backed up (as .bak) */
	backedUp: string[];
	/** Files that were skipped (dry-run mode) */
	skipped: string[];
}

/**
 * Options for executing onboard.
 */
export interface OnboardExecuteOptions {
	/** Create .bak files for overwritten files */
	backup: boolean;
	/** Skip files that already exist (don't overwrite) */
	skip: boolean;
	/** Only report what would be done, don't actually copy */
	dryRun: boolean;
}

// =============================================================================
// Scheduler Types
// =============================================================================

/**
 * Information about a scheduled job.
 */
export interface SchedulerJobInfo {
	/** Job name */
	name: string;
	/** Cron schedule expression */
	schedule: string;
	/** Next scheduled run time (ISO string), or null if not scheduled */
	nextRun: string | null;
}

// =============================================================================
// Line Decoder (for socket communication)
// =============================================================================

/**
 * Decoder for streaming JSON line messages.
 */
class LineDecoder {
	private _buffer = '';

	feed(data: string | Buffer): unknown[] {
		const str = typeof data === 'string' ? data : data.toString('utf8');
		this._buffer += str;
		const messages: unknown[] = [];
		const lines = this._buffer.split('\n');

		// Keep the last incomplete line in the buffer
		this._buffer = lines.pop() ?? '';

		for (const line of lines) {
			if (line.trim()) {
				try {
					messages.push(JSON.parse(line));
				} catch {
					// Skip malformed JSON
				}
			}
		}

		return messages;
	}

	reset(): void {
		this._buffer = '';
	}
}

/**
 * Encode a message for transport.
 */
function encode(message: object): Buffer {
	const json = JSON.stringify(message);
	return Buffer.from(`${json}\n`, 'utf8');
}

// =============================================================================
// DaemonClient Options
// =============================================================================

/**
 * Configuration for connecting to the daemon.
 */
export interface DaemonClientOptions {
	/** Unix socket path or TCP address */
	socketPath?: string;
	/** Connection timeout in milliseconds */
	connectTimeoutMs?: number;
	/** Request timeout in milliseconds */
	requestTimeoutMs?: number;
}

/**
 * Default client configuration.
 */
const DEFAULT_OPTIONS = {
	connectTimeoutMs: 5000,
	requestTimeoutMs: 30000,
} as const;

// =============================================================================
// Pending Request Tracker
// =============================================================================

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error when not connected to daemon.
 */
export class NotConnectedError extends Error {
	constructor(message = 'Not connected to daemon') {
		super(message);
		this.name = 'NotConnectedError';
	}
}

/**
 * Error when request times out.
 */
export class RequestTimeoutError extends Error {
	readonly requestId: string;
	readonly timeoutMs: number;

	constructor(requestId: string, timeoutMs: number) {
		super(`Request ${requestId} timed out after ${timeoutMs}ms`);
		this.name = 'RequestTimeoutError';
		this.requestId = requestId;
		this.timeoutMs = timeoutMs;
	}
}

/**
 * Error from RPC response.
 */
export class RpcResponseError extends Error {
	readonly code: number;
	readonly data?: unknown;

	constructor(code: number, message: string, data?: unknown) {
		super(message);
		this.name = 'RpcResponseError';
		this.code = code;
		this.data = data;
	}
}

function rethrowChannelNotFound(error: unknown, id: string): never {
	if (error instanceof RpcResponseError && error.code === RpcApplicationErrorCode.NotFound) {
		throw new NotFoundError('Channel', id);
	}
	throw error;
}

// =============================================================================
// DaemonClient Interface
// =============================================================================

/**
 * Interface for daemon client operations.
 */
export interface DaemonClient {
	/** Connect to the daemon */
	connect(): Promise<void>;

	/** Disconnect from the daemon */
	disconnect(): Promise<void>;

	/** Check if connected */
	readonly connected: boolean;

	// Daemon methods
	ping(): Promise<{ pong: true }>;
	status(): Promise<DaemonStatus>;
	shutdown(mode: 'graceful' | 'hard', timeout?: number): Promise<void>;
	reload(): Promise<{ reloaded: string[] }>;

	// Agent methods
	listAgents(params?: RpcMethods['agent.list']): Promise<RpcMethodResults['agent.list']>;
	getAgent(id: string): Promise<AgentDetails>;
	spawnAgent(options: SpawnAgentOptions): Promise<RpcMethodResults['agent.spawn']>;
	continueAgent(sessionId: string, message: string, model?: string): Promise<{ id: string }>;
	listCheckpoints(): Promise<string[]>;
	terminateAgent(id: string, reason?: string): Promise<void>;
	pauseAgent(id: string): Promise<void>;
	resumeAgent(id: string): Promise<void>;
	sendToAgent(id: string, content: string, role?: string): Promise<void>;
	getAgentSnapshot(id: string): Promise<AgentSnapshot>;

	// Channel methods
	listChannels(): Promise<ChannelSummary[]>;
	getChannel(id: string): Promise<ChannelDetails>;
	connectChannel(id: string): Promise<RpcMethodResults['channel.connect']>;
	disconnectChannel(id: string): Promise<RpcMethodResults['channel.disconnect']>;
	reconnectChannel(id: string): Promise<RpcMethodResults['channel.reconnect']>;

	// Conversation methods
	listConversations(filter?: ConversationFilter): Promise<ConversationSummary[]>;
	getConversation(channelId: string, ref: string, includeHistory?: boolean): Promise<ConversationDetails>;
	unbindConversation(channelId: string, ref: string): Promise<void>;

	// Config methods
	getConfig(section?: string): Promise<unknown>;
	validateConfig(): Promise<{ valid: boolean; errors?: string[] }>;

	// Onboard methods
	onboardStatus(): Promise<OnboardStatus>;
	onboardExecute(options: OnboardExecuteOptions): Promise<OnboardResult>;

	// Scheduler methods
	listSchedulerJobs(): Promise<SchedulerJobInfo[]>;
	triggerJob(name: string): Promise<void>;

	// Subscriptions
	subscribeAgents(params?: RpcMethods['subscribe.agents']): Promise<RpcMethodResults['subscribe.agents']>;
	subscribeAgentOutput(
		params: RpcMethods['subscribe.agent.output'],
	): Promise<RpcMethodResults['subscribe.agent.output']>;
	subscribeChannels(): Promise<RpcMethodResults['subscribe.channels']>;
	subscribeLogs(params: RpcMethods['subscribe.logs']): Promise<RpcMethodResults['subscribe.logs']>;
	unsubscribe(subscriptionId: string): Promise<RpcMethodResults['unsubscribe']>;
	onNotification(handler: (notification: RpcNotification) => void): () => void;
}

// =============================================================================
// SocketDaemonClient Implementation
// =============================================================================

/**
 * DaemonClient implementation using Unix sockets.
 */
class SocketDaemonClient implements DaemonClient {
	private readonly _socketPath: string;
	private readonly _connectTimeoutMs: number;
	private readonly _requestTimeoutMs: number;
	private readonly _notificationHandlers: Set<(notification: RpcNotification) => void> = new Set();
	private readonly _pendingRequests: Map<string, PendingRequest> = new Map();
	private readonly _decoder = new LineDecoder();

	private _socket: net.Socket | null = null;
	private _connected = false;
	private _nextRequestId = 1;

	constructor(options: DaemonClientOptions = {}) {
		this._socketPath = options.socketPath ?? getSocketPath();
		this._connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_OPTIONS.connectTimeoutMs;
		this._requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_OPTIONS.requestTimeoutMs;
	}

	get connected(): boolean {
		return this._connected;
	}

	async connect(): Promise<void> {
		if (this._connected) {
			return;
		}

		const net = await import('node:net');

		return new Promise((resolve, reject) => {
			const socket = net.createConnection(this._socketPath);
			this._socket = socket;

			const connectTimeout = setTimeout(() => {
				socket.destroy();
				reject(new Error(`Connection timeout after ${this._connectTimeoutMs}ms`));
			}, this._connectTimeoutMs);

			socket.on('connect', () => {
				clearTimeout(connectTimeout);
				this._connected = true;
				resolve();
			});

			socket.on('error', (err) => {
				clearTimeout(connectTimeout);
				if (!this._connected) {
					reject(err);
				}
			});

			socket.on('data', (data: Buffer) => {
				const messages = this._decoder.feed(data);
				for (const message of messages) {
					this._handleMessage(message);
				}
			});

			socket.on('close', () => {
				this._connected = false;
				this._socket = null;
				this._decoder.reset();

				// Reject all pending requests
				for (const [id, pending] of this._pendingRequests) {
					clearTimeout(pending.timeout);
					pending.reject(new NotConnectedError('Connection closed'));
					this._pendingRequests.delete(id);
				}
			});
		});
	}

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

	private async _request<T>(method: string, params?: unknown): Promise<T> {
		if (!this._connected || !this._socket) {
			throw new NotConnectedError();
		}

		const id = `req-${this._nextRequestId++}`;
		const request: RpcRequest = { id, method, params };

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this._pendingRequests.delete(id);
				reject(new RequestTimeoutError(id, this._requestTimeoutMs));
			}, this._requestTimeoutMs);

			this._pendingRequests.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeout,
			});

			const data = encode(request);
			this._socket?.write(data);
		});
	}

	private _handleMessage(message: unknown): void {
		if (typeof message !== 'object' || message === null) {
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
		}
	}

	private _handleResponse(response: RpcResponse): void {
		const pending = this._pendingRequests.get(response.id);
		if (!pending) {
			return;
		}

		this._pendingRequests.delete(response.id);
		clearTimeout(pending.timeout);

		if (response.error) {
			pending.reject(new RpcResponseError(response.error.code, response.error.message, response.error.data));
		} else {
			pending.resolve(response.result);
		}
	}

	private _handleNotification(notification: RpcNotification): void {
		for (const handler of this._notificationHandlers) {
			try {
				handler(notification);
			} catch {
				// Ignore handler errors
			}
		}
	}

	// =========================================================================
	// Daemon Methods
	// =========================================================================

	async ping(): Promise<{ pong: true }> {
		return this._request('daemon.ping');
	}

	async status(): Promise<DaemonStatus> {
		return this._request('daemon.status');
	}

	async shutdown(mode: 'graceful' | 'hard', timeout?: number): Promise<void> {
		return this._request('daemon.shutdown', { mode, timeout });
	}

	async reload(): Promise<{ reloaded: string[] }> {
		return this._request('daemon.reload');
	}

	// =========================================================================
	// Agent Methods
	// =========================================================================

	async listAgents(params: RpcMethods['agent.list'] = {}): Promise<RpcMethodResults['agent.list']> {
		return this._request('agent.list', params);
	}

	async getAgent(id: string): Promise<AgentDetails> {
		const agent = await this._request<RpcMethodResults['agent.get']>('agent.get', { id });
		if (agent === null) {
			throw new Error(`Agent not found: ${id}`);
		}
		return agent;
	}

	async spawnAgent(options: SpawnAgentOptions): Promise<RpcMethodResults['agent.spawn']> {
		return this._request('agent.spawn', options);
	}

	async continueAgent(sessionId: string, message: string, model?: string): Promise<{ id: string }> {
		return this._request('agent.continue', {
			sessionId,
			input: { message },
			model,
		});
	}

	async listCheckpoints(): Promise<string[]> {
		return this._request('agent.listCheckpoints', {});
	}

	async terminateAgent(id: string, reason?: string): Promise<void> {
		return this._request('agent.terminate', { id, reason });
	}

	async pauseAgent(id: string): Promise<void> {
		return this._request('agent.pause', { id });
	}

	async resumeAgent(id: string): Promise<void> {
		return this._request('agent.resume', { id });
	}

	async sendToAgent(id: string, content: string, role = 'user'): Promise<void> {
		return this._request('agent.send', { id, content, role });
	}

	async getAgentSnapshot(id: string): Promise<AgentSnapshot> {
		return this._request('agent.snapshot', { id });
	}

	// =========================================================================
	// Channel Methods
	// =========================================================================

	async listChannels(): Promise<ChannelSummary[]> {
		return this._request('channel.list');
	}

	async getChannel(id: string): Promise<ChannelDetails> {
		const channel = await this._request<RpcMethodResults['channel.get']>('channel.get', { id });
		if (channel === null) {
			throw new NotFoundError('Channel', id);
		}
		return channel;
	}

	async connectChannel(id: string): Promise<RpcMethodResults['channel.connect']> {
		try {
			return await this._request<RpcMethodResults['channel.connect']>('channel.connect', { id });
		} catch (error) {
			rethrowChannelNotFound(error, id);
		}
	}

	async disconnectChannel(id: string): Promise<RpcMethodResults['channel.disconnect']> {
		try {
			return await this._request<RpcMethodResults['channel.disconnect']>('channel.disconnect', { id });
		} catch (error) {
			rethrowChannelNotFound(error, id);
		}
	}

	async reconnectChannel(id: string): Promise<RpcMethodResults['channel.reconnect']> {
		try {
			return await this._request<RpcMethodResults['channel.reconnect']>('channel.reconnect', { id });
		} catch (error) {
			rethrowChannelNotFound(error, id);
		}
	}

	// =========================================================================
	// Conversation Methods
	// =========================================================================

	async listConversations(filter?: ConversationFilter): Promise<ConversationSummary[]> {
		return this._request('conversation.list', filter);
	}

	async getConversation(channelId: string, ref: string, includeHistory = false): Promise<ConversationDetails> {
		return this._request('conversation.get', {
			channelId,
			ref,
			includeHistory,
		});
	}

	async unbindConversation(channelId: string, ref: string): Promise<void> {
		return this._request('conversation.unbind', { channelId, ref });
	}

	// =========================================================================
	// Config Methods
	// =========================================================================

	async getConfig(section?: string): Promise<unknown> {
		return this._request('config.get', { section });
	}

	async validateConfig(): Promise<{ valid: boolean; errors?: string[] }> {
		return this._request('config.validate');
	}

	// =========================================================================
	// Onboard Methods
	// =========================================================================

	async onboardStatus(): Promise<OnboardStatus> {
		return this._request('onboard.status');
	}

	async onboardExecute(options: OnboardExecuteOptions): Promise<OnboardResult> {
		return this._request('onboard.execute', options);
	}

	// =========================================================================
	// Scheduler Methods
	// =========================================================================

	async listSchedulerJobs(): Promise<SchedulerJobInfo[]> {
		const result = await this._request<{ jobs: SchedulerJobInfo[] }>('scheduler.list');
		return result.jobs;
	}

	async triggerJob(name: string): Promise<void> {
		await this._request('scheduler.trigger', { job: name });
	}

	// =========================================================================
	// Subscription Methods
	// =========================================================================

	async subscribeAgents(params: RpcMethods['subscribe.agents'] = {}): Promise<RpcMethodResults['subscribe.agents']> {
		return this._request('subscribe.agents', params);
	}

	async subscribeAgentOutput(
		params: RpcMethods['subscribe.agent.output'],
	): Promise<RpcMethodResults['subscribe.agent.output']> {
		return this._request('subscribe.agent.output', params);
	}

	async subscribeChannels(): Promise<RpcMethodResults['subscribe.channels']> {
		return this._request('subscribe.channels', {});
	}

	async subscribeLogs(params: RpcMethods['subscribe.logs']): Promise<RpcMethodResults['subscribe.logs']> {
		return this._request('subscribe.logs', params);
	}

	async unsubscribe(subscriptionId: string): Promise<RpcMethodResults['unsubscribe']> {
		return this._request('unsubscribe', { subscriptionId });
	}

	onNotification(handler: (notification: RpcNotification) => void): () => void {
		this._notificationHandlers.add(handler);
		return () => {
			this._notificationHandlers.delete(handler);
		};
	}
}

// =============================================================================
// Platform-specific Socket Path
// =============================================================================

/**
 * Get the default socket path for the daemon.
 */
function getDefaultSocketPath(name = 'daemon'): string {
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\genii-${name}`;
	}

	// Prefer XDG_RUNTIME_DIR if available (more secure)
	const runtimeDir = process.env.XDG_RUNTIME_DIR;
	if (runtimeDir) {
		return `${runtimeDir}/genii-${name}.sock`;
	}

	// Fall back to /tmp
	return `/tmp/genii-${name}.sock`;
}

/**
 * Get the socket path from environment or default.
 */
export function getSocketPath(): string {
	return process.env.GENII_SOCKET ?? getDefaultSocketPath();
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a DaemonClient with the given options.
 */
export function createDaemonClient(options?: DaemonClientOptions): DaemonClient {
	return new SocketDaemonClient(options);
}

/**
 * Alias for createDaemonClient (backwards compatibility).
 */
export const createClient = createDaemonClient;
