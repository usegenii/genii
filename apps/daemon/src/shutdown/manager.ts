/**
 * ShutdownManager for coordinating graceful daemon shutdown.
 *
 * The ShutdownManager is responsible for:
 * - Coordinating shutdown across all subsystems with priority-based ordering
 * - Managing graceful shutdown deadlines and hard shutdown budgets
 * - Executing handlers in priority order (lower numbers first)
 * - Reporting handler failures and incomplete hard shutdowns
 */

import { DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS, FORCED_DAEMON_SHUTDOWN_TIMEOUT_MS } from '@genii/lib/rpc/methods';
import type { Logger } from '../logging/logger';

/**
 * Shutdown mode determines how handlers are executed.
 * - 'graceful': Wait for handlers while the graceful deadline remains
 * - 'hard': Finish as much cleanup as possible within one overall hard budget
 */
export type ShutdownMode = 'graceful' | 'hard';

/** The result of a shutdown sequence. */
export interface ShutdownResult {
	mode: ShutdownMode;
	completed: boolean;
	failedHandlers: string[];
}

/** A registered shutdown handler. */
export interface ShutdownHandler {
	name: string;
	priority: number;
	execute(mode: ShutdownMode, remainingTimeMs?: number, signal?: AbortSignal): Promise<void>;
}

/** ShutdownManager interface for coordinating daemon shutdown. */
export interface IShutdownManager {
	register(
		name: string,
		handler: (mode: ShutdownMode, remainingTimeMs?: number, signal?: AbortSignal) => Promise<void>,
		priority: number,
	): void;
	unregister(name: string): void;
	execute(mode: ShutdownMode, gracefulTimeoutMs?: number): Promise<ShutdownResult>;
	readonly isShuttingDown: boolean;
}

/** Configuration for shutdown behavior. */
export interface ShutdownConfig {
	/** Overall budget for hard shutdown in milliseconds. */
	hardTimeoutMs: number;
}

/** Default shutdown configuration. */
const DEFAULT_SHUTDOWN_CONFIG: ShutdownConfig = {
	hardTimeoutMs: FORCED_DAEMON_SHUTDOWN_TIMEOUT_MS,
};

type HardModeReason = 'requested' | 'concurrent-request' | 'graceful-timeout';

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
	private _executionSettled = false;
	private _inFlight: Promise<ShutdownResult> | undefined;
	private _mode: ShutdownMode = 'graceful';
	private _failedHandlers = new Set<string>();
	private _gracefulAbortController: AbortController | undefined;

	private _gracefulDeadline: number | undefined;
	private _gracefulTimer: ReturnType<typeof setTimeout> | undefined;
	private _hardDeadline: number | undefined;
	private _hardTimer: ReturnType<typeof setTimeout> | undefined;
	private _hardTimedOut = false;
	private _hardTimeoutPromise: Promise<void> | undefined;
	private _hardRequestedPromise: Promise<void> | undefined;
	private _resolveHardRequested: (() => void) | undefined;

	constructor(logger: Logger, config: Partial<ShutdownConfig> = {}) {
		this._logger = logger;
		this._config = { ...DEFAULT_SHUTDOWN_CONFIG, ...config };
	}

	/** Register a shutdown handler. */
	register(
		name: string,
		handler: (mode: ShutdownMode, remainingTimeMs?: number, signal?: AbortSignal) => Promise<void>,
		priority: number,
	): void {
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

	/** Unregister a shutdown handler. */
	unregister(name: string): void {
		if (this._handlers.delete(name)) {
			this._logger.debug({ name }, 'Unregistered shutdown handler');
		}
	}

	/**
	 * Execute the shutdown sequence.
	 *
	 * The first call owns execution. Later calls share its result, and a hard
	 * request upgrades an active graceful sequence immediately.
	 */
	execute(
		mode: ShutdownMode,
		gracefulTimeoutMs: number = DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS,
	): Promise<ShutdownResult> {
		if (this._inFlight) {
			this._logger.warn('Shutdown already in progress');
			if (mode === 'hard' && !this._executionSettled) {
				this._enterHardMode('concurrent-request');
			}
			return this._inFlight;
		}

		this._isShuttingDown = true;
		this._executionSettled = false;
		this._mode = 'graceful';
		this._failedHandlers = new Set();
		this._hardTimedOut = false;
		this._gracefulAbortController = new AbortController();
		this._hardRequestedPromise = new Promise<void>((resolve) => {
			this._resolveHardRequested = resolve;
		});

		if (mode === 'hard') {
			this._enterHardMode('requested');
		} else {
			this._startGracefulDeadline(this._normalizeTimeout(gracefulTimeoutMs, DEFAULT_DAEMON_SHUTDOWN_TIMEOUT_MS));
		}

		this._logger.info({ mode, gracefulTimeoutMs }, 'Starting shutdown sequence');

		// Defer execution by one microtask so the shared promise is installed
		// before a handler can make a re-entrant shutdown request.
		this._inFlight = Promise.resolve().then(() => this._executeSequence());
		return this._inFlight;
	}

	/** Check if shutdown is in progress. */
	get isShuttingDown(): boolean {
		return this._isShuttingDown;
	}

	/** Execute each priority level until cleanup completes or the hard budget expires. */
	private async _executeSequence(): Promise<ShutdownResult> {
		try {
			const handlersByPriority = this._groupHandlersByPriority();
			const priorities = Array.from(handlersByPriority.keys()).sort((a, b) => a - b);

			this._logger.debug({ priorities, handlerCount: this._handlers.size }, 'Executing handlers by priority');

			for (let index = 0; index < priorities.length; index++) {
				const priority = priorities[index];
				if (priority === undefined) continue;
				const handlers = handlersByPriority.get(priority) ?? [];
				const completedWithinBudget = await this._executePriorityLevel(priority, handlers);

				if (!completedWithinBudget) {
					this._invokeRemainingPriorities(priorities, index + 1, handlersByPriority);
					break;
				}
			}

			if (this._mode === 'graceful' && this._deadlineExpired(this._gracefulDeadline)) {
				this._enterHardMode('graceful-timeout');
			}
			if (this._mode === 'hard' && this._deadlineExpired(this._hardDeadline)) {
				this._markHardTimedOut(
					this._normalizeTimeout(this._config.hardTimeoutMs, FORCED_DAEMON_SHUTDOWN_TIMEOUT_MS),
				);
			}

			const failedHandlers = [...this._handlers.values()]
				.map((handler) => handler.name)
				.filter((name) => this._failedHandlers.has(name));
			const result: ShutdownResult = {
				mode: this._mode,
				completed: !this._hardTimedOut && failedHandlers.length === 0,
				failedHandlers,
			};

			this._logger.info(result, 'Shutdown sequence complete');
			return result;
		} finally {
			this._executionSettled = true;
			this._gracefulAbortController = undefined;
			this._clearGracefulTimer();
			this._clearHardTimer();
		}
	}

	/** Group handlers by their priority level. */
	private _groupHandlersByPriority(): Map<number, ShutdownHandler[]> {
		const grouped = new Map<number, ShutdownHandler[]>();

		for (const handler of this._handlers.values()) {
			const existing = grouped.get(handler.priority) ?? [];
			existing.push(handler);
			grouped.set(handler.priority, existing);
		}

		return grouped;
	}

	/** Execute all handlers at a priority level in parallel. */
	private async _executePriorityLevel(priority: number, handlers: ShutdownHandler[]): Promise<boolean> {
		const invocationMode = this._mode;
		const remainingTimeMs = this._remainingTime(invocationMode);
		const execution = this._invokePriority(priority, handlers, invocationMode, remainingTimeMs);

		if (invocationMode === 'graceful') {
			const status = await Promise.race([
				execution.then(() => 'completed' as const),
				(this._hardRequestedPromise ?? Promise.resolve()).then(() => 'hard' as const),
			]);

			if (status === 'completed' && !this._deadlineExpired(this._gracefulDeadline)) {
				this._logger.debug({ priority }, 'Priority level complete');
				return true;
			}
			if (status === 'completed') {
				this._enterHardMode('graceful-timeout');
			}
		}

		const completedWithinBudget = await this._waitWithinHardBudget(execution);
		if (completedWithinBudget) {
			this._logger.debug({ priority }, 'Priority level complete');
		} else {
			this._logger.warn({ priority }, 'Priority level exceeded the hard shutdown budget');
		}
		return completedWithinBudget;
	}

	/** Invoke one priority level and return a promise that always settles. */
	private _invokePriority(
		priority: number,
		handlers: ShutdownHandler[],
		mode: ShutdownMode,
		remainingTimeMs: number,
	): Promise<void> {
		const handlerNames = handlers.map((handler) => handler.name);
		this._logger.debug({ priority, handlers: handlerNames, mode, remainingTimeMs }, 'Executing priority level');
		const signal = mode === 'graceful' ? this._gracefulAbortController?.signal : undefined;
		return Promise.all(
			handlers.map((handler) => this._executeHandler(handler, mode, remainingTimeMs, signal)),
		).then(() => undefined);
	}

	/** Invoke all not-yet-started handlers after the hard budget expires. */
	private _invokeRemainingPriorities(
		priorities: number[],
		startIndex: number,
		handlersByPriority: Map<number, ShutdownHandler[]>,
	): void {
		for (let index = startIndex; index < priorities.length; index++) {
			const priority = priorities[index];
			if (priority === undefined) continue;
			const handlers = handlersByPriority.get(priority) ?? [];
			void this._invokePriority(priority, handlers, 'hard', 0);
			this._logger.debug({ priority }, 'Priority level invoked after hard shutdown timeout');
		}
	}

	/** Execute one handler while converting failures into a structured result. */
	private async _executeHandler(
		handler: ShutdownHandler,
		mode: ShutdownMode,
		remainingTimeMs: number,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			this._logger.debug({ handler: handler.name, priority: handler.priority }, 'Executing shutdown handler');
			await handler.execute(mode, remainingTimeMs, signal);
			this._logger.debug({ handler: handler.name }, 'Shutdown handler complete');
		} catch (error) {
			this._failedHandlers.add(handler.name);
			this._logger.error(
				{ error, handler: handler.name, priority: handler.priority },
				'Error in shutdown handler',
			);
		}
	}

	/** Start the graceful deadline. */
	private _startGracefulDeadline(timeoutMs: number): void {
		this._gracefulDeadline = Date.now() + timeoutMs;
		if (timeoutMs === 0) {
			this._enterHardMode('graceful-timeout');
			return;
		}

		this._gracefulTimer = setTimeout(() => {
			this._gracefulTimer = undefined;
			this._enterHardMode('graceful-timeout');
		}, timeoutMs);
	}

	/** Upgrade the active sequence to hard mode and start its one overall budget. */
	private _enterHardMode(reason: HardModeReason): void {
		if (this._mode === 'hard' || this._executionSettled) {
			return;
		}

		this._mode = 'hard';
		this._gracefulAbortController?.abort();
		this._clearGracefulTimer();
		if (reason === 'graceful-timeout') {
			this._logger.warn('Graceful shutdown timed out; escalating to hard shutdown');
		} else if (reason === 'concurrent-request') {
			this._logger.warn('Hard shutdown requested; escalating shutdown in progress');
		}

		const hardStartedAt = reason === 'graceful-timeout' ? (this._gracefulDeadline ?? Date.now()) : Date.now();
		this._startHardBudget(
			this._normalizeTimeout(this._config.hardTimeoutMs, FORCED_DAEMON_SHUTDOWN_TIMEOUT_MS),
			hardStartedAt,
		);
		this._resolveHardRequested?.();
		this._resolveHardRequested = undefined;
	}

	/** Start the one overall hard shutdown budget. */
	private _startHardBudget(timeoutMs: number, startedAt: number): void {
		this._hardDeadline = startedAt + timeoutMs;
		const remainingTimeMs = Math.max(0, this._hardDeadline - Date.now());
		if (remainingTimeMs === 0) {
			this._markHardTimedOut(timeoutMs);
			this._hardTimeoutPromise = Promise.resolve();
			return;
		}

		this._hardTimeoutPromise = new Promise<void>((resolve) => {
			this._hardTimer = setTimeout(() => {
				this._hardTimer = undefined;
				this._markHardTimedOut(timeoutMs);
				resolve();
			}, remainingTimeMs);
		});
	}

	/** Wait for work while the shared hard shutdown budget remains. */
	private async _waitWithinHardBudget(execution: Promise<void>): Promise<boolean> {
		if (this._hardTimedOut || this._deadlineExpired(this._hardDeadline)) {
			this._markHardTimedOut(this._config.hardTimeoutMs);
			return false;
		}

		const timeout = this._hardTimeoutPromise;
		if (!timeout) {
			return false;
		}

		const completed = await Promise.race([execution.then(() => true), timeout.then(() => false)]);
		if (completed && this._deadlineExpired(this._hardDeadline)) {
			this._markHardTimedOut(this._config.hardTimeoutMs);
			return false;
		}
		return completed;
	}

	/** Return the remaining time for the current phase. */
	private _remainingTime(mode: ShutdownMode): number {
		const deadline = mode === 'graceful' ? this._gracefulDeadline : this._hardDeadline;
		return Math.max(0, (deadline ?? Date.now()) - Date.now());
	}

	private _normalizeTimeout(timeoutMs: number, fallback: number): number {
		return Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : fallback;
	}

	private _deadlineExpired(deadline: number | undefined): boolean {
		return deadline !== undefined && Date.now() >= deadline;
	}

	private _markHardTimedOut(timeoutMs: number): void {
		if (this._hardTimedOut) {
			return;
		}
		this._hardTimedOut = true;
		this._clearHardTimer();
		this._logger.warn({ timeoutMs }, 'Hard shutdown budget exhausted');
	}

	private _clearGracefulTimer(): void {
		if (this._gracefulTimer !== undefined) {
			clearTimeout(this._gracefulTimer);
			this._gracefulTimer = undefined;
		}
	}

	private _clearHardTimer(): void {
		if (this._hardTimer !== undefined) {
			clearTimeout(this._hardTimer);
			this._hardTimer = undefined;
		}
	}
}
