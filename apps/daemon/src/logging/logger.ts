/**
 * Logger factory for daemon logging.
 *
 * Uses pino for structured JSON logging with support for:
 * - Log levels
 * - Child loggers with context
 * - File logging with daily rotation via pino-roll
 * - Pretty printing in development
 */

import { join } from 'node:path';
import { format } from 'node:util';
import type { RpcJsonObject, RpcJsonValue } from '@genii/lib/rpc/methods';
import type { TransportTargetOptions } from 'pino';
import pino from 'pino';
import type { LogBuffer, PendingLogEntry } from './buffer';

/**
 * Log level.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Logger configuration.
 */
export interface LoggerConfig {
	/** Minimum log level */
	level: LogLevel;
	/** Whether to use pretty printing (requires stdout to be a TTY) */
	pretty?: boolean;
	/** Directory for log files (enables file logging with rotation when set) */
	logDir?: string;
	/** Base context to include in all logs */
	context?: Record<string, unknown>;
	/** In-process replay buffer for RPC log subscriptions */
	logBuffer?: LogBuffer;
}

/**
 * Logger instance. Re-exported from pino for full API compatibility.
 */
export type Logger = pino.Logger;

interface LogCaptureState {
	buffer: LogBuffer;
	inProgress: boolean;
}

const LOG_METHOD_LEVELS: Readonly<Record<string, LogLevel>> = {
	trace: 'trace',
	debug: 'debug',
	info: 'info',
	warn: 'warn',
	error: 'error',
	fatal: 'fatal',
};

const attachedLogBuffers = new WeakMap<Logger, LogBuffer>();

function serializeLogData(value: unknown): RpcJsonObject | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}

	try {
		const seen = new WeakSet<object>();
		const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
			if (nestedValue instanceof Error) {
				return {
					name: nestedValue.name,
					message: nestedValue.message,
					stack: nestedValue.stack,
				};
			}
			if (typeof nestedValue === 'bigint') {
				return nestedValue.toString();
			}
			if (typeof nestedValue === 'object' && nestedValue !== null) {
				if (seen.has(nestedValue)) {
					return '[Circular]';
				}
				seen.add(nestedValue);
			}
			return nestedValue;
		});
		if (!serialized) {
			return undefined;
		}
		const parsed = JSON.parse(serialized) as RpcJsonValue;
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : { value: parsed };
	} catch {
		try {
			return { value: String(value) };
		} catch {
			return { value: '[Unserializable]' };
		}
	}
}

function normalizeLogCall(args: unknown[], level: LogLevel, bindings: pino.Bindings): PendingLogEntry {
	const [first, second, ...rest] = args;
	const data = serializeLogData(first);
	let message: string;

	if (typeof first === 'string') {
		message = format(first, ...args.slice(1));
	} else if (typeof second === 'string') {
		message = format(second, ...rest);
	} else if (first instanceof Error) {
		message = first.message;
	} else {
		message = format(first);
	}

	const componentValue = data?.component ?? bindings.component;
	return {
		timestamp: Date.now(),
		level,
		message,
		...(typeof componentValue === 'string' ? { component: componentValue } : {}),
		...(data ? { data } : {}),
	};
}

function wrapLoggerWithBuffer(logger: Logger, state: LogCaptureState): Logger {
	const wrapped = new Proxy(logger, {
		get(target, property) {
			if (property === 'child') {
				const createChild = target.child.bind(target) as unknown as (
					bindings: pino.Bindings,
					options?: pino.ChildLoggerOptions,
				) => Logger;
				return (bindings: pino.Bindings, options?: pino.ChildLoggerOptions) =>
					wrapLoggerWithBuffer(createChild(bindings, options), state);
			}

			const level = typeof property === 'string' ? LOG_METHOD_LEVELS[property] : undefined;
			if (level) {
				const method = Reflect.get(target, property, target) as pino.LogFn;
				return (...args: Parameters<pino.LogFn>) => {
					if (!state.inProgress && target.isLevelEnabled(level)) {
						state.inProgress = true;
						try {
							state.buffer.append(normalizeLogCall(args as unknown[], level, target.bindings()));
						} finally {
							state.inProgress = false;
						}
					}
					method.apply(target, args);
				};
			}

			const value = Reflect.get(target, property, target) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	attachedLogBuffers.set(wrapped, state.buffer);
	return wrapped;
}

/**
 * Attach a replay buffer to an existing logger and all child loggers it creates.
 *
 * The wrapper preserves the logger's configured level, so disabled calls are not
 * added to the replay stream. Attaching the same buffer more than once is a no-op.
 */
export function attachLogBuffer(logger: Logger, buffer: LogBuffer): Logger {
	if (attachedLogBuffers.get(logger) === buffer) {
		return logger;
	}

	return wrapLoggerWithBuffer(logger, { buffer, inProgress: false });
}

/**
 * Create a logger instance.
 *
 * When `logDir` is provided, logs are written to `{logDir}/daemon.log` with:
 * - Daily rotation (new file each day)
 * - Size-based rotation (new file at 10 MB)
 * - Retention of last 7 rotated files
 *
 * When `pretty` is true and stdout is a TTY, also writes human-readable
 * output to stdout (useful for foreground/development mode).
 *
 * @param config - Logger configuration
 * @returns A configured pino logger instance
 */
export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
	const level = config.level ?? 'info';

	const pinoOpts: pino.LoggerOptions = {
		level,
		serializers: {
			error: pino.stdSerializers.err,
		},
	};
	if (config.context) {
		pinoOpts.base = config.context;
	}

	const targets: TransportTargetOptions[] = [];

	// File logging with rotation
	if (config.logDir) {
		targets.push({
			target: 'pino-roll',
			options: {
				file: join(config.logDir, 'daemon.log'),
				frequency: 'daily',
				size: '10m',
				limit: { count: 7 },
				mkdir: true,
			},
			level,
		});
	}

	// Pretty stdout in development/foreground mode
	if (config.pretty && process.stdout.isTTY) {
		targets.push({
			target: 'pino-pretty',
			options: { colorize: true },
			level,
		});
	}

	// No transports configured — use default pino (JSON to stdout)
	const logger =
		targets.length === 0
			? pino(pinoOpts)
			: pino({
					...pinoOpts,
					transport: targets.length === 1 ? targets[0] : { targets },
				});

	return config.logBuffer ? attachLogBuffer(logger, config.logBuffer) : logger;
}

/**
 * Default logger configuration.
 */
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
	level: 'info',
	pretty: process.env.NODE_ENV !== 'production',
};
