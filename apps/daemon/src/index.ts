/**
 * Entry point for the daemon process.
 *
 * This module handles:
 * - Command line argument parsing
 * - Process signal handling (SIGINT, SIGTERM, SIGUSR1)
 * - Daemon lifecycle management (startup, shutdown)
 * - Uncaught exception handling
 * - Process exit coordination
 *
 * @example
 * ```ts
 * // Start the daemon
 * import { main } from '@apps/daemon/index';
 * await main();
 * ```
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '@geniigotchi/config/config';
import { createDefaultSecretStore } from '@geniigotchi/config/secrets/composite';
import { createModelFactory } from '@geniigotchi/models/factory';
import { initializeChannels } from './channels/init';
import type { Daemon } from './daemon';
import { type CreateDaemonOptions, createDaemon } from './factory';
import { createLogger, type LogLevel } from './logging/logger';

/** Interval for second SIGINT detection (hard shutdown) */
const HARD_SHUTDOWN_INTERVAL_MS = 3000;

/**
 * Get the default data path for the current platform.
 */
function getDefaultDataPath(): string {
	const home = homedir();
	if (process.platform === 'darwin') {
		return join(home, 'Library', 'Application Support', 'geniigotchi');
	}
	if (process.platform === 'win32') {
		return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'geniigotchi');
	}
	// Linux/Unix - use XDG_DATA_HOME or fallback
	return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'geniigotchi');
}

/**
 * Parsed command line arguments.
 */
interface ParsedArgs {
	socketPath?: string;
	logLevel?: LogLevel;
	dataPath?: string;
	guidancePath?: string;
	help: boolean;
}

/**
 * Parse command line arguments.
 *
 * Supported arguments:
 * - --socket, -s: Override socket path
 * - --log-level, -l: Override log level (trace, debug, info, warn, error)
 * - --data, -d: Override data directory (stores config, conversations, snapshots, guidance)
 * - --guidance, -g: Override guidance directory (defaults to {dataPath}/guidance)
 * - --help, -h: Show help
 */
function parseArguments(): ParsedArgs {
	const { values } = parseArgs({
		options: {
			socket: {
				type: 'string',
				short: 's',
			},
			'log-level': {
				type: 'string',
				short: 'l',
			},
			data: {
				type: 'string',
				short: 'd',
			},
			guidance: {
				type: 'string',
				short: 'g',
			},
			help: {
				type: 'boolean',
				short: 'h',
				default: false,
			},
		},
		strict: true,
		allowPositionals: false,
	});

	// Validate log level if provided
	const logLevel = values['log-level'] as string | undefined;
	if (logLevel !== undefined) {
		const validLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];
		if (!validLevels.includes(logLevel as LogLevel)) {
			console.error(`Invalid log level: ${logLevel}. Must be one of: ${validLevels.join(', ')}`);
			process.exit(1);
		}
	}

	return {
		socketPath: values.socket,
		logLevel: logLevel as LogLevel | undefined,
		dataPath: values.data,
		guidancePath: values.guidance,
		help: values.help ?? false,
	};
}

/**
 * Print help message and exit.
 */
function printHelp(): void {
	console.log(`
geniigotchi-daemon - Background daemon for managing AI agents

Usage: geniigotchi-daemon [options]

Options:
  -s, --socket <path>      Override socket path for IPC
  -l, --log-level <level>  Log level (trace, debug, info, warn, error)
  -d, --data <path>        Override data directory (config, conversations, snapshots, guidance)
  -g, --guidance <path>    Override guidance directory (defaults to {data}/guidance)
  -h, --help               Show this help message

Examples:
  geniigotchi-daemon
  geniigotchi-daemon --log-level debug
  geniigotchi-daemon --socket /tmp/custom.sock
  geniigotchi-daemon --data ~/.local/share/geniigotchi
`);
}

/**
 * Set up process signal handlers for graceful shutdown.
 *
 * Signal handling:
 * - SIGINT (Ctrl+C): First triggers graceful shutdown, second within 3s triggers hard shutdown
 * - SIGTERM: Graceful shutdown
 * - SIGUSR1: Reload configuration (optional, currently logs a message)
 *
 * @param daemon - The daemon instance to control
 * @param logger - Logger for logging signal events
 * @returns Cleanup function to remove signal handlers
 */
function setupSignalHandlers(daemon: Daemon, logger: ReturnType<typeof createLogger>): () => void {
	let lastSigintTime = 0;
	let shuttingDown = false;

	const handleSigint = async (): Promise<void> => {
		const now = Date.now();

		if (shuttingDown && now - lastSigintTime < HARD_SHUTDOWN_INTERVAL_MS) {
			// Second SIGINT within threshold - hard shutdown
			logger.warn('Received second SIGINT, performing hard shutdown');
			await daemon.stop('hard');
			process.exit(1);
		}

		lastSigintTime = now;

		if (!shuttingDown) {
			shuttingDown = true;
			logger.info(
				'Received SIGINT, performing graceful shutdown (press Ctrl+C again within 3s for hard shutdown)',
			);
			try {
				await daemon.stop('graceful');
				process.exit(0);
			} catch (error) {
				logger.error({ error }, 'Error during graceful shutdown');
				process.exit(1);
			}
		}
	};

	const handleSigterm = async (): Promise<void> => {
		if (shuttingDown) {
			logger.warn('Shutdown already in progress, ignoring SIGTERM');
			return;
		}

		shuttingDown = true;
		logger.info('Received SIGTERM, performing graceful shutdown');
		try {
			await daemon.stop('graceful');
			process.exit(0);
		} catch (error) {
			logger.error({ error }, 'Error during graceful shutdown');
			process.exit(1);
		}
	};

	const handleSigusr1 = (): void => {
		logger.info('Received SIGUSR1, config reload requested (not yet implemented)');
		// In a full implementation, this would reload configuration
		// For now, we just log the signal
	};

	// Set up signal handlers
	process.on('SIGINT', () => {
		handleSigint().catch((error) => {
			logger.error({ error }, 'Error handling SIGINT');
			process.exit(1);
		});
	});

	process.on('SIGTERM', () => {
		handleSigterm().catch((error) => {
			logger.error({ error }, 'Error handling SIGTERM');
			process.exit(1);
		});
	});

	// SIGUSR1 is not available on Windows
	if (process.platform !== 'win32') {
		process.on('SIGUSR1', handleSigusr1);
	}

	// Return cleanup function
	return () => {
		process.removeAllListeners('SIGINT');
		process.removeAllListeners('SIGTERM');
		if (process.platform !== 'win32') {
			process.removeAllListeners('SIGUSR1');
		}
	};
}

/**
 * Set up global error handlers.
 *
 * @param logger - Logger for logging errors
 */
function setupErrorHandlers(logger: ReturnType<typeof createLogger>): void {
	process.on('uncaughtException', (error) => {
		logger.fatal({ error }, 'Uncaught exception');
		process.exit(1);
	});

	process.on('unhandledRejection', (reason) => {
		logger.fatal({ reason }, 'Unhandled rejection');
		process.exit(1);
	});
}

/**
 * Main entry point for the daemon.
 *
 * Implementation:
 * 1. Parse command line arguments
 * 2. Create daemon using factory
 * 3. Start daemon
 * 4. Set up signal handlers
 * 5. Wait for daemon to stop
 */
export async function main(): Promise<void> {
	// Parse command line arguments
	const args = parseArguments();

	// Show help and exit if requested
	if (args.help) {
		printHelp();
		process.exit(0);
	}

	// Create logger for startup messages
	const logger = createLogger({ level: args.logLevel ?? 'info' });

	// Set up error handlers
	setupErrorHandlers(logger);

	logger.info('Starting geniigotchi daemon');

	// Determine data path (use default if not specified)
	const dataPath = args.dataPath ?? getDefaultDataPath();

	// Load configuration from data path
	logger.debug({ dataPath }, 'Loading configuration');
	const config = await loadConfig({ basePath: dataPath });

	// Create secret store
	const secretStore = createDefaultSecretStore(dataPath, 'geniigotchi');

	// Create model factory
	const modelFactory = createModelFactory({ config, secretStore });

	// Initialize channels from configuration
	logger.debug('Initializing channels');
	const channelRegistry = await initializeChannels(config, secretStore, logger);

	// Build daemon options from arguments
	const options: CreateDaemonOptions = {
		dataPath,
		modelFactory,
		channelRegistry,
		config,
	};
	if (args.socketPath !== undefined) {
		options.socketPath = args.socketPath;
	}
	if (args.logLevel !== undefined) {
		options.logLevel = args.logLevel;
	}
	if (args.guidancePath !== undefined) {
		options.guidancePath = args.guidancePath;
	}

	try {
		// Create daemon
		const daemon = await createDaemon(options);

		// Set up signal handlers
		const cleanupSignals = setupSignalHandlers(daemon, logger);

		// Start daemon
		await daemon.start();

		logger.info({ status: daemon.status }, 'Daemon is running');

		// Wait indefinitely - signal handlers will trigger shutdown
		await new Promise<void>(() => {
			// This promise never resolves - we rely on signal handlers to exit
		});

		// Cleanup (unreachable, but good practice)
		cleanupSignals();
	} catch (error) {
		logger.fatal({ error }, 'Failed to start daemon');
		process.exit(1);
	}
}

/**
 * Start the daemon process.
 *
 * Alias for main() for backward compatibility.
 */
export const startDaemon = main;

// Run main when this module is executed directly
// Only run if this file is the entry point
const isMainModule = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMainModule) {
	main().catch((error) => {
		console.error('Fatal error:', error);
		process.exit(1);
	});
}
