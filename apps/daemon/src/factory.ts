/**
 * Factory function for creating a fully configured Daemon instance.
 *
 * This module handles:
 * - Loading configuration from disk/environment
 * - Creating and wiring all daemon subsystems
 * - Dependency injection setup
 */

import { join } from 'node:path';
import type { ChannelRegistry } from '@genii/comms/registry/types';
import type { Config } from '@genii/config/config';
import { getDefaultBasePath } from '@genii/config/paths';
import { DEFAULT_PULSE_SCHEDULE } from '@genii/config/types/preferences';
import type { ModelFactory } from '@genii/models/factory';
import { DateTimeContextInjector } from '@genii/orchestrator/context-injectors/datetime/injector';
import { IdentityContextInjector } from '@genii/orchestrator/context-injectors/identity/injector';
import { InstructionsContextInjector } from '@genii/orchestrator/context-injectors/instructions/injector';
import { MemoriesPathContextInjector } from '@genii/orchestrator/context-injectors/memories-path/injector';
import { PulseContextInjector } from '@genii/orchestrator/context-injectors/pulse/injector';
import { ContextInjectorRegistry } from '@genii/orchestrator/context-injectors/registry';
import { SkillsContextInjector } from '@genii/orchestrator/context-injectors/skills/injector';
import { SoulContextInjector } from '@genii/orchestrator/context-injectors/soul/injector';
import { TasksContextInjector } from '@genii/orchestrator/context-injectors/tasks/injector';
import { createCoordinator } from '@genii/orchestrator/coordinator/impl';
import type { Coordinator } from '@genii/orchestrator/coordinator/types';
import { createFileSnapshotStore } from '@genii/orchestrator/snapshot/store';
import type { SnapshotStore } from '@genii/orchestrator/snapshot/types';
import { createDateTimeTool } from '@genii/orchestrator/tools/datetime/tool';
import { createToolRegistry } from '@genii/orchestrator/tools/registry';
import { DEFAULT_MAX_OUTPUT_LENGTH, DEFAULT_TIMEOUT_MS } from '@genii/orchestrator/tools/shell/constants';
import { createShellTool } from '@genii/orchestrator/tools/shell/tool';
import type { ToolRegistryInterface } from '@genii/orchestrator/tools/types';
import { setupCommandSystem } from './commands/setup';
import { ConversationManager } from './conversations/manager';
import { createFileConversationStore } from './conversations/store';
import { type Daemon, type DaemonConfig, DaemonImpl } from './daemon';
import { createLogger, type Logger, type LogLevel } from './logging/logger';
import { resolveDefaultModel } from './models/resolve';
import { createMessageRouter, type MessageRouterConfig } from './router/router';
import { createHandlers, type DaemonRuntimeConfig } from './rpc/handlers';
import { createRpcServer, type RpcServer } from './rpc/server';
import { createSubscriptionManager } from './rpc/subscriptions';
import { createDestinationResolver } from './scheduler/destination-resolver';
import { createPulseJob } from './scheduler/jobs/pulse';
import { createLastActiveTracker } from './scheduler/last-active-tracker';
import { createScheduler } from './scheduler/scheduler';
import { ShutdownManager } from './shutdown/manager';
import { SocketTransportServer } from './transport/socket/server';
import type { TransportConnection } from './transport/types';

/** Daemon version */
const DAEMON_VERSION = '1.0.0';

/**
 * Options for creating a daemon via the factory.
 */
export interface CreateDaemonOptions {
	/** Override socket path */
	socketPath?: string;
	/** Override log level */
	logLevel?: LogLevel;
	/** Override data directory (stores config, conversations, snapshots, guidance) */
	dataPath?: string;
	/** Override guidance directory (defaults to {dataPath}/guidance) */
	guidancePath?: string;
	/** Model factory for creating adapters */
	modelFactory?: ModelFactory;
	/** Channel registry with configured channels */
	channelRegistry?: ChannelRegistry;
	/** Loaded configuration */
	config?: Config;
}

/**
 * Resolve the daemon log level using precedence:
 * 1) explicit CLI/runtime override
 * 2) preferences.toml logging level
 * 3) default info
 */
export function resolveDaemonLogLevel(options: Pick<CreateDaemonOptions, 'logLevel' | 'config'>): LogLevel {
	const configLogLevel = options.config?.getPreferences()?.logging?.level;
	return options.logLevel ?? configLogLevel ?? 'info';
}

/**
 * Get the default socket path for the current platform.
 */
function getDefaultSocketPath(): string {
	if (process.platform === 'win32') {
		return '\\\\.\\pipe\\genii-daemon';
	}
	return '/tmp/genii-daemon.sock';
}

/**
 * Create a placeholder channel registry for initial setup.
 * This will be replaced when actual channels are registered.
 */
function createPlaceholderChannelRegistry(): ChannelRegistry {
	return {
		register: () => {},
		unregister: () => {},
		get: () => undefined,
		list: () => [],
		subscribe: () => () => {},
		events: () => ({
			[Symbol.asyncIterator]: async function* () {
				// Empty async iterator
			},
		}),
		process: async () => ({
			intentType: 'agent_thinking',
			success: false,
			timestamp: Date.now(),
		}),
	};
}

/**
 * Configuration for creating an RPC server with all dependencies.
 */
interface CreateRpcServerDepsConfig {
	config: DaemonRuntimeConfig;
	transport: SocketTransportServer;
	coordinator: Coordinator;
	channelRegistry: ChannelRegistry;
	conversationManager: ConversationManager;
	shutdownManager: ShutdownManager;
	logger: Logger;
	modelFactory?: ModelFactory;
	appConfig?: Config;
	toolRegistry?: ToolRegistryInterface;
	scheduler?: ReturnType<typeof createScheduler>;
}

/**
 * Create an RPC server with all dependencies wired up.
 */
function createRpcServerWithDeps(deps: CreateRpcServerDepsConfig): {
	rpcServer: RpcServer;
	connections: Map<string, TransportConnection>;
} {
	// Track connections for subscription manager
	const connections = new Map<string, TransportConnection>();

	// Create subscription manager
	const subscriptionManager = createSubscriptionManager({
		logger: deps.logger,
		getConnection: (connectionId) => connections.get(connectionId),
	});

	// Create base handler context (without connection - added per-request)
	const handlerContext = {
		coordinator: deps.coordinator,
		channelRegistry: deps.channelRegistry,
		conversationManager: deps.conversationManager,
		config: deps.config,
		shutdownManager: deps.shutdownManager,
		subscriptionManager,
		logger: deps.logger,
		modelFactory: deps.modelFactory,
		appConfig: deps.appConfig,
		toolRegistry: deps.toolRegistry,
		scheduler: deps.scheduler,
	};

	// Create handlers
	const handlers = createHandlers(handlerContext);

	// Create and return RPC server
	const rpcServer = createRpcServer({
		transport: deps.transport,
		handlerContext,
		handlers,
		subscriptionManager,
		logger: deps.logger,
	});

	return { rpcServer, connections };
}

/**
 * Create a fully configured Daemon instance.
 *
 * This is the main entry point for instantiating the daemon.
 * It handles all dependency injection and configuration loading.
 *
 * @param options - Optional configuration overrides
 * @returns A configured Daemon instance ready to start
 *
 * @example
 * ```ts
 * const daemon = await createDaemon();
 * await daemon.start();
 *
 * // Or with options
 * const daemon = await createDaemon({
 *   socketPath: '/custom/path.sock',
 *   logLevel: 'debug',
 * });
 * ```
 */
export async function createDaemon(options: CreateDaemonOptions = {}): Promise<Daemon> {
	// Resolve configuration
	const socketPath = options.socketPath ?? getDefaultSocketPath();
	const dataPath = options.dataPath ?? getDefaultBasePath();
	const logLevel = resolveDaemonLogLevel(options);

	const config: DaemonConfig = {
		socketPath,
		dataPath,
		logLevel,
	};

	// Create logger
	const logger = createLogger({ level: logLevel });

	// Resolve guidance path early so we can log it
	const guidancePath = options.guidancePath ?? join(dataPath, 'guidance');

	logger.info({ config: { socketPath, dataPath, guidancePath, logLevel } }, 'Creating daemon');

	// Create shutdown manager
	const shutdownManager = new ShutdownManager(logger);

	// Create coordinator with guidance directory, skills, and snapshot store
	const snapshotPath = join(dataPath, 'snapshots');
	const skillsPath = join(dataPath, 'skills');
	const snapshotStore = createFileSnapshotStore({ directory: snapshotPath });

	// Create and configure context injector registry with all injectors
	const contextInjectorRegistry = new ContextInjectorRegistry({ logger });
	contextInjectorRegistry.register(new SoulContextInjector());
	contextInjectorRegistry.register(new IdentityContextInjector());
	contextInjectorRegistry.register(new InstructionsContextInjector());
	contextInjectorRegistry.register(new SkillsContextInjector());
	contextInjectorRegistry.register(new MemoriesPathContextInjector());
	contextInjectorRegistry.register(new DateTimeContextInjector());
	contextInjectorRegistry.register(new TasksContextInjector());
	contextInjectorRegistry.register(new PulseContextInjector());

	// Resolve timezone from preferences or system default
	const timezone = options.config?.getPreferences()?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

	const coordinator = createCoordinator({
		defaultGuidancePath: guidancePath,
		skillsPath,
		snapshotStore,
		logger,
		contextInjectorRegistry,
		timezone,
	});

	// Use provided channel registry or create a placeholder
	const channelRegistry = options.channelRegistry ?? createPlaceholderChannelRegistry();

	// Create conversation store and manager
	const conversationStorePath = join(dataPath, 'conversations.json');
	const conversationStore = createFileConversationStore(conversationStorePath, logger);
	const conversationManager = new ConversationManager(logger, conversationStore);

	// Set up command system
	const { registry: commandRegistry, executor: commandExecutor } = setupCommandSystem(
		{
			coordinator,
			conversations: conversationManager,
			logger,
		},
		logger,
	);

	// Create tool registry with shell tool and datetime tool
	const toolRegistry = createToolRegistry({ logger });
	const shellPrefs = options.config?.getPreferences()?.agents?.tools?.shell;
	const shellTool = createShellTool({
		defaultWorkingDir: shellPrefs?.defaultWorkingDir,
		defaultTimeout: shellPrefs?.defaultTimeout ?? DEFAULT_TIMEOUT_MS,
		maxOutputLength: shellPrefs?.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH,
	});
	toolRegistry.register(shellTool);

	// Register datetime tool
	const dateTimeTool = createDateTimeTool({ timezone });
	toolRegistry.register(dateTimeTool);

	// Create last active tracker for pulse response routing
	const lastActiveTrackerPath = join(dataPath, 'last-active.json');
	const lastActiveTracker = createLastActiveTracker(lastActiveTrackerPath, logger);

	// Create adapter factory for reuse
	const adapterFactory = async () => {
		if (!options.modelFactory) {
			throw new Error('ModelFactory not configured');
		}
		if (!options.config) {
			throw new Error('Config not provided - cannot resolve default model');
		}

		const model = resolveDefaultModel(options.config);
		return options.modelFactory.createAdapter(model);
	};

	// Create message router with configured adapter factory
	const routerConfig: MessageRouterConfig = {
		coordinator,
		channelRegistry,
		conversationManager,
		adapterFactory,
		defaultSpawnContext: {
			guidancePath,
		},
		logger,
		commandExecutor,
		toolRegistry,
		lastActiveTracker,
	};
	const router = createMessageRouter(routerConfig);

	// Create scheduler if enabled
	const schedulerConfig = options.config?.getPreferences()?.scheduler;
	let scheduler: ReturnType<typeof createScheduler> | undefined;

	if (schedulerConfig?.enabled && schedulerConfig.pulse) {
		const pulseSchedule = schedulerConfig.pulse.schedule ?? DEFAULT_PULSE_SCHEDULE;
		const destinationResolver = createDestinationResolver(schedulerConfig, lastActiveTracker, logger);

		scheduler = createScheduler({ logger });

		const pulseJob = createPulseJob({
			config: {
				schedule: pulseSchedule,
				promptPath: schedulerConfig.pulse.promptPath,
				responseTo: schedulerConfig.pulse.responseTo,
			},
			coordinator,
			channelRegistry,
			destinationResolver,
			adapterFactory,
			guidancePath,
			toolRegistry,
			logger,
		});

		scheduler.register(pulseJob, pulseSchedule);
		logger.info({ schedule: pulseSchedule }, 'Registered pulse job');
	}

	// Create transport server
	const transport = new SocketTransportServer(
		{
			socketPath: config.socketPath,
		},
		logger,
	);

	// Create runtime config for handlers
	const runtimeConfig: DaemonRuntimeConfig = {
		socketPath: config.socketPath,
		storagePath: config.dataPath,
		guidancePath,
		logLevel: config.logLevel,
		startTime: Date.now(),
		version: DAEMON_VERSION,
	};

	// Create RPC server with all dependencies
	const { rpcServer } = createRpcServerWithDeps({
		config: runtimeConfig,
		transport,
		coordinator,
		channelRegistry,
		conversationManager,
		shutdownManager,
		logger,
		modelFactory: options.modelFactory,
		appConfig: options.config,
		toolRegistry,
		scheduler,
	});

	// Create and return daemon instance
	return new DaemonImpl(config, {
		logger,
		shutdownManager,
		coordinator,
		channelRegistry,
		conversationManager,
		router,
		rpcServer,
		commandRegistry,
		scheduler,
		lastActiveTracker,
	});
}

/**
 * Extended options for creating a daemon with custom subsystems.
 */
export interface CreateDaemonWithDepsOptions extends CreateDaemonOptions {
	/** Custom logger instance */
	logger?: Logger;
	/** Custom coordinator instance */
	coordinator?: Coordinator;
	/** Custom channel registry instance */
	channelRegistry?: ChannelRegistry;
	/** Custom snapshot store instance */
	snapshotStore?: SnapshotStore;
}

/**
 * Create a daemon with custom dependency injection.
 *
 * This variant allows providing custom implementations of subsystems,
 * useful for testing or advanced configurations.
 *
 * @param options - Configuration and custom dependencies
 * @returns A configured Daemon instance
 */
export async function createDaemonWithDeps(options: CreateDaemonWithDepsOptions = {}): Promise<Daemon> {
	// Resolve configuration
	const socketPath = options.socketPath ?? getDefaultSocketPath();
	const dataPath = options.dataPath ?? getDefaultBasePath();
	const logLevel = resolveDaemonLogLevel(options);

	const config: DaemonConfig = {
		socketPath,
		dataPath,
		logLevel,
	};

	// Use provided logger or create one
	const logger = options.logger ?? createLogger({ level: logLevel });

	// Resolve guidance path early so we can log it
	const guidancePath = options.guidancePath ?? join(dataPath, 'guidance');

	logger.info({ config: { socketPath, dataPath, guidancePath, logLevel } }, 'Creating daemon with deps');

	// Create shutdown manager
	const shutdownManager = new ShutdownManager(logger);

	// Create or use provided coordinator with snapshot store
	const snapshotPath = join(dataPath, 'snapshots');
	const skillsPath = join(dataPath, 'skills');
	const snapshotStore = options.snapshotStore ?? createFileSnapshotStore({ directory: snapshotPath });

	// Create and configure context injector registry with all injectors
	const contextInjectorRegistry = new ContextInjectorRegistry({ logger });
	contextInjectorRegistry.register(new SoulContextInjector());
	contextInjectorRegistry.register(new IdentityContextInjector());
	contextInjectorRegistry.register(new InstructionsContextInjector());
	contextInjectorRegistry.register(new SkillsContextInjector());
	contextInjectorRegistry.register(new MemoriesPathContextInjector());
	contextInjectorRegistry.register(new DateTimeContextInjector());
	contextInjectorRegistry.register(new TasksContextInjector());
	contextInjectorRegistry.register(new PulseContextInjector());

	// Resolve timezone from preferences or system default
	const timezone = options.config?.getPreferences()?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

	// Use provided or create coordinator with snapshot store
	const coordinator =
		options.coordinator ??
		createCoordinator({
			defaultGuidancePath: guidancePath,
			skillsPath,
			snapshotStore,
			logger,
			contextInjectorRegistry,
			timezone,
		});
	const channelRegistry = options.channelRegistry ?? createPlaceholderChannelRegistry();

	// Create conversation store and manager
	const conversationStorePath = join(dataPath, 'conversations.json');
	const conversationStore = createFileConversationStore(conversationStorePath, logger);
	const conversationManager = new ConversationManager(logger, conversationStore);

	// Set up command system
	const { registry: commandRegistry, executor: commandExecutor } = setupCommandSystem(
		{
			coordinator,
			conversations: conversationManager,
			logger,
		},
		logger,
	);

	// Create tool registry with shell tool and datetime tool
	const toolRegistry = createToolRegistry({ logger });
	const shellPrefs = options.config?.getPreferences()?.agents?.tools?.shell;
	const shellTool = createShellTool({
		defaultWorkingDir: shellPrefs?.defaultWorkingDir,
		defaultTimeout: shellPrefs?.defaultTimeout ?? DEFAULT_TIMEOUT_MS,
		maxOutputLength: shellPrefs?.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH,
	});
	toolRegistry.register(shellTool);

	// Register datetime tool
	const dateTimeTool = createDateTimeTool({ timezone });
	toolRegistry.register(dateTimeTool);

	// Create last active tracker for pulse response routing
	const lastActiveTrackerPath = join(dataPath, 'last-active.json');
	const lastActiveTracker = createLastActiveTracker(lastActiveTrackerPath, logger);

	// Create adapter factory for reuse
	const adapterFactory = async () => {
		if (!options.modelFactory) {
			throw new Error('ModelFactory not configured');
		}
		if (!options.config) {
			throw new Error('Config not provided - cannot resolve default model');
		}

		const model = resolveDefaultModel(options.config);
		return options.modelFactory.createAdapter(model);
	};

	// Create message router with configured adapter factory
	const routerConfig: MessageRouterConfig = {
		coordinator,
		channelRegistry,
		conversationManager,
		adapterFactory,
		defaultSpawnContext: {
			guidancePath,
		},
		logger,
		commandExecutor,
		toolRegistry,
		lastActiveTracker,
	};
	const router = createMessageRouter(routerConfig);

	// Create scheduler if enabled
	const schedulerConfig = options.config?.getPreferences()?.scheduler;
	let scheduler: ReturnType<typeof createScheduler> | undefined;

	if (schedulerConfig?.enabled && schedulerConfig.pulse) {
		const pulseSchedule = schedulerConfig.pulse.schedule ?? DEFAULT_PULSE_SCHEDULE;
		const destinationResolver = createDestinationResolver(schedulerConfig, lastActiveTracker, logger);

		scheduler = createScheduler({ logger });

		const pulseJob = createPulseJob({
			config: {
				schedule: pulseSchedule,
				promptPath: schedulerConfig.pulse.promptPath,
				responseTo: schedulerConfig.pulse.responseTo,
			},
			coordinator,
			channelRegistry,
			destinationResolver,
			adapterFactory,
			guidancePath,
			toolRegistry,
			logger,
		});

		scheduler.register(pulseJob, pulseSchedule);
		logger.info({ schedule: pulseSchedule }, 'Registered pulse job');
	}

	// Create transport server
	const transport = new SocketTransportServer(
		{
			socketPath: config.socketPath,
		},
		logger,
	);

	// Create runtime config for handlers
	const runtimeConfig: DaemonRuntimeConfig = {
		socketPath: config.socketPath,
		storagePath: config.dataPath,
		guidancePath,
		logLevel: config.logLevel,
		startTime: Date.now(),
		version: DAEMON_VERSION,
	};

	// Create RPC server with all dependencies
	const { rpcServer } = createRpcServerWithDeps({
		config: runtimeConfig,
		transport,
		coordinator,
		channelRegistry,
		conversationManager,
		shutdownManager,
		logger,
		modelFactory: options.modelFactory,
		appConfig: options.config,
		toolRegistry,
		scheduler,
	});

	// Create and return daemon instance
	return new DaemonImpl(config, {
		logger,
		shutdownManager,
		coordinator,
		channelRegistry,
		conversationManager,
		router,
		rpcServer,
		commandRegistry,
		scheduler,
		lastActiveTracker,
	});
}
