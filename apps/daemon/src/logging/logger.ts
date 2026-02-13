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
import type { TransportTargetOptions } from 'pino';
import pino from 'pino';

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
}

/**
 * Logger instance. Re-exported from pino for full API compatibility.
 */
export type Logger = pino.Logger;

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

	const pinoOpts: pino.LoggerOptions = { level };
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
	if (targets.length === 0) {
		return pino(pinoOpts);
	}

	return pino({
		...pinoOpts,
		transport: targets.length === 1 ? targets[0] : { targets },
	});
}

/**
 * Default logger configuration.
 */
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
	level: 'info',
	pretty: process.env.NODE_ENV !== 'production',
};
