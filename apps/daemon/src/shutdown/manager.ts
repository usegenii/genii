/**
 * ShutdownManager for coordinating graceful daemon shutdown.
 *
 * The ShutdownManager is responsible for:
 * - Coordinating shutdown across all subsystems with priority-based ordering
 * - Managing shutdown timeouts (graceful vs hard mode)
 * - Executing handlers in priority order (lower numbers first)
 * - Handling errors gracefully during shutdown
 */

import type { Logger } from '../logging/logger';

/**
 * Shutdown mode determines how handlers are executed.
 * - 'graceful': Wait for all handlers to complete
 * - 'hard': Use a timeout per priority level
 */
export type ShutdownMode = 'graceful' | 'hard';

/**
 * A registered shutdown handler.
 */
export interface ShutdownHandler {
	name: string;
	priority: number;
	execute(mode: ShutdownMode): Promise<void>;
}

/**
 * ShutdownManager interface for coordinating daemon shutdown.
 */
export interface IShutdownManager {
	register(name: string, handler: (mode: ShutdownMode) => Promise<void>, priority: number): void;
	unregister(name: string): void;
	execute(mode: ShutdownMode): Promise<void>;
	readonly isShuttingDown: boolean;
}

/**
 * Configuration for shutdown behavior.
 */
export interface ShutdownConfig {
	/** Timeout for hard shutdown per priority level in milliseconds */
	hardTimeoutMs: number;
}

/**
 * Default shutdown configuration.
 */
const DEFAULT_SHUTDOWN_CONFIG: ShutdownConfig = {
	hardTimeoutMs: 5000,
};

/**
 * ShutdownManager coordinates graceful shutdown of all daemon components.
 *
 * Shutdown priorities:
 * - Priority 0: Stop accepting new work (pause channel polling)
 * - Priority 10: Suspend/finish agents (graceful) or terminate (hard)
 * - Priority 20: Disconnect channels
 * - Priority 30: Snapshot conversation bindings, flush logs
 */
export class ShutdownManager implements IShutdownManager {
	private readonly _logger: Logger;
	private readonly _config: ShutdownConfig;
	private readonly _handlers: Map<string, ShutdownHandler> = new Map();

	private _isShuttingDown = false;

	constructor(logger: Logger, config: Partial<ShutdownConfig> = {}) {
		this._logger = logger;
		this._config = { ...DEFAULT_SHUTDOWN_CONFIG, ...config };
	}

	/**
	 * Register a shutdown handler.
	 *
	 * @param name - Unique name for the handler
	 * @param handler - The handler function to execute during shutdown
	 * @param priority - Priority level (lower numbers execute first)
	 */
	register(name: string, handler: (mode: ShutdownMode) => Promise<void>, priority: number): void {
		if (this._handlers.has(name)) {
			this._logger.warn({ name }, 'Replacing existing shutdown handler');
		}

		this._handlers.set(name, {
			name,
			priority,
			execute: handler,
		});

		this._logger.debug({ name, priority }, 'Registered shutdown handler');
	}

	/**
	 * Unregister a shutdown handler.
	 *
	 * @param name - Name of the handler to remove
	 */
	unregister(name: string): void {
		if (this._handlers.delete(name)) {
			this._logger.debug({ name }, 'Unregistered shutdown handler');
		}
	}

	/**
	 * Execute shutdown sequence.
	 *
	 * Runs handlers in priority order (lower numbers first).
	 * Handlers with the same priority execute in parallel.
	 *
	 * @param mode - Shutdown mode ('graceful' or 'hard')
	 */
	async execute(mode: ShutdownMode): Promise<void> {
		if (this._isShuttingDown) {
			this._logger.warn('Shutdown already in progress');
			return;
		}

		this._isShuttingDown = true;
		this._logger.info({ mode }, 'Starting shutdown sequence');

		// Group handlers by priority
		const handlersByPriority = this._groupHandlersByPriority();
		const priorities = Array.from(handlersByPriority.keys()).sort((a, b) => a - b);

		this._logger.debug({ priorities, handlerCount: this._handlers.size }, 'Executing handlers by priority');

		for (const priority of priorities) {
			const handlers = handlersByPriority.get(priority) ?? [];
			await this._executePriorityLevel(priority, handlers, mode);
		}

		this._logger.info({ mode }, 'Shutdown sequence complete');
	}

	/**
	 * Check if shutdown is in progress.
	 */
	get isShuttingDown(): boolean {
		return this._isShuttingDown;
	}

	/**
	 * Group handlers by their priority level.
	 */
	private _groupHandlersByPriority(): Map<number, ShutdownHandler[]> {
		const grouped = new Map<number, ShutdownHandler[]>();

		for (const handler of this._handlers.values()) {
			const existing = grouped.get(handler.priority) ?? [];
			existing.push(handler);
			grouped.set(handler.priority, existing);
		}

		return grouped;
	}

	/**
	 * Execute all handlers at a given priority level.
	 *
	 * @param priority - The priority level being executed
	 * @param handlers - Handlers to execute
	 * @param mode - Shutdown mode
	 */
	private async _executePriorityLevel(
		priority: number,
		handlers: ShutdownHandler[],
		mode: ShutdownMode,
	): Promise<void> {
		const handlerNames = handlers.map((h) => h.name);
		this._logger.debug({ priority, handlers: handlerNames }, 'Executing priority level');

		const executePromises = handlers.map((handler) => this._executeHandler(handler, mode));

		if (mode === 'graceful') {
			// In graceful mode, wait for all handlers to complete
			await Promise.all(executePromises);
		} else {
			// In hard mode, use a timeout per priority level
			const timeoutPromise = new Promise<void>((resolve) => {
				setTimeout(() => {
					this._logger.warn({ priority, timeoutMs: this._config.hardTimeoutMs }, 'Priority level timed out');
					resolve();
				}, this._config.hardTimeoutMs);
			});

			await Promise.race([Promise.all(executePromises), timeoutPromise]);
		}

		this._logger.debug({ priority }, 'Priority level complete');
	}

	/**
	 * Execute a single handler with error handling.
	 *
	 * @param handler - The handler to execute
	 * @param mode - Shutdown mode
	 */
	private async _executeHandler(handler: ShutdownHandler, mode: ShutdownMode): Promise<void> {
		try {
			this._logger.debug({ handler: handler.name, priority: handler.priority }, 'Executing shutdown handler');
			await handler.execute(mode);
			this._logger.debug({ handler: handler.name }, 'Shutdown handler complete');
		} catch (error) {
			this._logger.error(
				{ error, handler: handler.name, priority: handler.priority },
				'Error in shutdown handler',
			);
			// Continue with other handlers even on error
		}
	}
}
