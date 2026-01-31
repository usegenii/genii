/**
 * Main Daemon class that orchestrates all daemon components.
 *
 * The Daemon is the central coordinator that:
 * - Manages the lifecycle of all subsystems
 * - Coordinates between RPC server, message router, and conversation manager
 * - Handles graceful startup and shutdown
 * - Provides health status information
 */

import type { ChannelRegistry } from '@geniigotchi/comms/registry/types';
import type { Coordinator } from '@geniigotchi/orchestrator/coordinator/types';
import type { CommandRegistryInterface } from './commands/registry';
import type { ConversationManager } from './conversations/manager';
import type { Logger, LogLevel } from './logging/logger';
import type { MessageRouter } from './router/router';
import type { RpcServer } from './rpc/server';
import type { LastActiveTracker } from './scheduler/last-active-tracker';
import type { Scheduler } from './scheduler/scheduler';
import type { ShutdownManager, ShutdownMode } from './shutdown/manager';

/** Daemon version */
const DAEMON_VERSION = '1.0.0';

/**
 * State of the daemon throughout its lifecycle.
 */
export type DaemonState = 'stopped' | 'starting' | 'running' | 'stopping';

/**
 * Configuration for the Daemon.
 */
export interface DaemonConfig {
	/** Path to the Unix socket for IPC */
	socketPath: string;
	/** Path to data directory (config, conversations, snapshots, guidance) */
	dataPath: string;
	/** Log level */
	logLevel: LogLevel;
}

/**
 * Status information for the daemon.
 */
export interface DaemonStatus {
	/** Current state of the daemon */
	state: DaemonState;
	/** When the daemon was started */
	startedAt?: Date;
	/** Number of running agents */
	agentCount: number;
	/** Number of registered channels */
	channelCount: number;
	/** Number of active RPC connections */
	connectionCount: number;
	/** Daemon version */
	version: string;
}

/**
 * Daemon interface.
 */
export interface Daemon {
	/**
	 * Start the daemon and all subsystems.
	 */
	start(): Promise<void>;

	/**
	 * Stop the daemon.
	 *
	 * @param mode - Shutdown mode ('graceful' or 'hard'). Defaults to 'graceful'.
	 */
	stop(mode?: ShutdownMode): Promise<void>;

	/**
	 * Get the current status of the daemon.
	 */
	readonly status: DaemonStatus;

	/**
	 * Get the uptime in milliseconds.
	 */
	readonly uptime: number;
}

/**
 * Dependencies required by the Daemon.
 */
export interface DaemonDependencies {
	/** Logger instance */
	logger: Logger;
	/** Shutdown manager for coordinating shutdown */
	shutdownManager: ShutdownManager;
	/** Coordinator for managing agents */
	coordinator: Coordinator;
	/** Channel registry for managing channels */
	channelRegistry: ChannelRegistry;
	/** Conversation manager for bindings */
	conversationManager: ConversationManager;
	/** Message router for routing messages */
	router: MessageRouter;
	/** RPC server for client connections */
	rpcServer: RpcServer;
	/** Command registry for slash commands (optional) */
	commandRegistry?: CommandRegistryInterface;
	/** Scheduler for periodic jobs (optional) */
	scheduler?: Scheduler;
	/** Last active tracker for pulse response routing (optional) */
	lastActiveTracker?: LastActiveTracker;
}

/**
 * Main daemon class that coordinates all subsystems.
 */
export class DaemonImpl implements Daemon {
	private readonly _config: DaemonConfig;
	private readonly _logger: Logger;
	private readonly _shutdownManager: ShutdownManager;
	private readonly _coordinator: Coordinator;
	private readonly _channelRegistry: ChannelRegistry;
	private readonly _conversationManager: ConversationManager;
	private readonly _router: MessageRouter;
	private readonly _rpcServer: RpcServer;
	private readonly _commandRegistry: CommandRegistryInterface | undefined;
	private readonly _scheduler: Scheduler | undefined;
	private readonly _lastActiveTracker: LastActiveTracker | undefined;

	private _state: DaemonState = 'stopped';
	private _startedAt: Date | undefined;

	constructor(config: DaemonConfig, deps: DaemonDependencies) {
		this._config = config;
		this._logger = deps.logger.child({ component: 'Daemon' });
		this._shutdownManager = deps.shutdownManager;
		this._coordinator = deps.coordinator;
		this._channelRegistry = deps.channelRegistry;
		this._conversationManager = deps.conversationManager;
		this._router = deps.router;
		this._rpcServer = deps.rpcServer;
		this._commandRegistry = deps.commandRegistry;
		this._scheduler = deps.scheduler;
		this._lastActiveTracker = deps.lastActiveTracker;
	}

	/**
	 * Start the daemon and all subsystems.
	 *
	 * Boot Sequence:
	 * 1. Initialize coordinator
	 * 2. Start conversation manager (loads persisted state)
	 * 3. Start message router (connects to channels and coordinator)
	 * 4. Start last active tracker (loads persisted state)
	 * 5. Start scheduler (register jobs, start cron)
	 * 6. Register shutdown handlers
	 * 7. Start RPC server (starts accepting connections)
	 * 8. Connect all registered channels
	 */
	async start(): Promise<void> {
		if (this._state !== 'stopped') {
			throw new Error(`Cannot start daemon in state: ${this._state}`);
		}

		this._state = 'starting';
		this._logger.info({ socketPath: this._config.socketPath, dataPath: this._config.dataPath }, 'Starting daemon');

		try {
			// Step 1: Start coordinator
			this._logger.debug('Starting coordinator');
			await this._coordinator.start();

			// Step 2: Start conversation manager (loads persisted state)
			this._logger.debug('Starting conversation manager');
			await this._conversationManager.start();

			// Step 3: Start message router
			this._logger.debug('Starting message router');
			await this._router.start();

			// Step 4: Start last active tracker (loads persisted state)
			if (this._lastActiveTracker) {
				this._logger.debug('Loading last active tracker state');
				await this._lastActiveTracker.load();
			}

			// Step 5: Start scheduler
			if (this._scheduler) {
				this._logger.debug('Starting scheduler');
				await this._scheduler.start();
			}

			// Step 6: Register shutdown handlers with priorities
			this._registerShutdownHandlers();

			// Step 7: Start RPC server
			this._logger.debug('Starting RPC server');
			await this._rpcServer.start();

			// Step 8: Connect all registered channels
			this._logger.debug('Connecting channels');
			await this._connectChannels();

			// Mark as running
			this._state = 'running';
			this._startedAt = new Date();

			this._logger.info(
				{
					socketPath: this._config.socketPath,
					version: DAEMON_VERSION,
				},
				'Daemon started successfully',
			);
		} catch (error) {
			this._state = 'stopped';
			this._logger.error({ error }, 'Failed to start daemon');
			throw error;
		}
	}

	/**
	 * Stop the daemon.
	 *
	 * Shutdown Sequence:
	 * The shutdown manager executes handlers in priority order.
	 *
	 * @param mode - Shutdown mode ('graceful' or 'hard'). Defaults to 'graceful'.
	 */
	async stop(mode: ShutdownMode = 'graceful'): Promise<void> {
		if (this._state !== 'running') {
			this._logger.warn({ state: this._state }, 'Cannot stop daemon - not running');
			return;
		}

		this._state = 'stopping';
		this._logger.info({ mode }, 'Stopping daemon');

		try {
			await this._shutdownManager.execute(mode);
			this._state = 'stopped';
			this._startedAt = undefined;
			this._logger.info('Daemon stopped successfully');
		} catch (error) {
			this._logger.error({ error }, 'Error during daemon shutdown');
			this._state = 'stopped';
			throw error;
		}
	}

	/**
	 * Get the current status of the daemon.
	 */
	get status(): DaemonStatus {
		return {
			state: this._state,
			startedAt: this._startedAt,
			agentCount: this._coordinator.list().length,
			channelCount: this._channelRegistry.list().length,
			connectionCount: this._rpcServer.connectionCount,
			version: DAEMON_VERSION,
		};
	}

	/**
	 * Get the uptime in milliseconds.
	 */
	get uptime(): number {
		if (!this._startedAt) {
			return 0;
		}
		return Date.now() - this._startedAt.getTime();
	}

	/**
	 * Register shutdown handlers with the shutdown manager.
	 *
	 * Priorities:
	 * - 0: Stop accepting new work (RPC server)
	 * - 5: Stop scheduler (prevent new pulse sessions)
	 * - 10: Disconnect channels
	 * - 20: Stop message router
	 * - 25: Save last active tracker state
	 * - 30: Shutdown coordinator (suspends/terminates agents)
	 * - 40: Stop conversation manager (persists state)
	 */
	private _registerShutdownHandlers(): void {
		// Priority 0: Stop RPC server (stop accepting new connections/requests)
		this._shutdownManager.register(
			'rpc-server',
			async () => {
				this._logger.debug('Stopping RPC server');
				await this._rpcServer.stop();
			},
			0,
		);

		// Priority 5: Stop scheduler (prevent new pulse sessions)
		if (this._scheduler) {
			this._shutdownManager.register(
				'scheduler',
				async () => {
					this._logger.debug('Stopping scheduler');
					await this._scheduler?.stop();
				},
				5,
			);
		}

		// Priority 10: Disconnect all channels
		this._shutdownManager.register(
			'channels',
			async () => {
				this._logger.debug('Disconnecting channels');
				await this._disconnectChannels();
			},
			10,
		);

		// Priority 20: Stop message router
		this._shutdownManager.register(
			'message-router',
			async () => {
				this._logger.debug('Stopping message router');
				await this._router.stop();
			},
			20,
		);

		// Priority 25: Save last active tracker state
		if (this._lastActiveTracker) {
			this._shutdownManager.register(
				'last-active-tracker',
				async () => {
					this._logger.debug('Saving last active tracker state');
					await this._lastActiveTracker?.save();
				},
				25,
			);
		}

		// Priority 30: Shutdown coordinator
		this._shutdownManager.register(
			'coordinator',
			async (mode) => {
				this._logger.debug({ mode }, 'Shutting down coordinator');
				await this._coordinator.shutdown({
					graceful: mode === 'graceful',
					timeoutMs: mode === 'graceful' ? 30000 : 5000,
				});
			},
			30,
		);

		// Priority 40: Stop conversation manager (persists bindings)
		this._shutdownManager.register(
			'conversation-manager',
			async () => {
				this._logger.debug('Stopping conversation manager');
				await this._conversationManager.stop();
			},
			40,
		);
	}

	/**
	 * Connect all registered channels.
	 */
	private async _connectChannels(): Promise<void> {
		const channels = this._channelRegistry.list();
		const commandDefs = this._commandRegistry?.definitions() ?? [];

		for (const channel of channels) {
			if (channel.status === 'disconnected') {
				try {
					this._logger.debug({ channelId: channel.id }, 'Connecting channel');
					await channel.connect();

					// Register slash commands if the channel supports it
					if (channel.setCommands && commandDefs.length > 0) {
						try {
							await channel.setCommands(commandDefs);
							this._logger.debug(
								{ channelId: channel.id, commandCount: commandDefs.length },
								'Registered commands with channel',
							);
						} catch (cmdError) {
							this._logger.warn(
								{ error: cmdError, channelId: channel.id },
								'Failed to register commands',
							);
						}
					}
				} catch (error) {
					this._logger.warn({ error, channelId: channel.id }, 'Failed to connect channel');
				}
			}
		}
	}

	/**
	 * Disconnect all connected channels.
	 */
	private async _disconnectChannels(): Promise<void> {
		const channels = this._channelRegistry.list();

		const disconnectPromises = channels
			.filter((channel) => channel.status === 'connected')
			.map(async (channel) => {
				try {
					this._logger.debug({ channelId: channel.id }, 'Disconnecting channel');
					await channel.disconnect();
				} catch (error) {
					this._logger.warn({ error, channelId: channel.id }, 'Error disconnecting channel');
				}
			});

		await Promise.all(disconnectPromises);
	}
}
