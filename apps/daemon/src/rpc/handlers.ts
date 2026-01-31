/**
 * RPC method handler implementations.
 *
 * This module provides:
 * - Handler implementations for all RPC methods
 * - Parameter validation
 * - Integration with daemon subsystems
 */

import type { ChannelRegistry } from '@geniigotchi/comms/registry/types';
import type { Config } from '@geniigotchi/config/config';
import type { ModelFactory } from '@geniigotchi/models/factory';
import type { Coordinator } from '@geniigotchi/orchestrator/coordinator/types';
import type { ToolRegistryInterface } from '@geniigotchi/orchestrator/tools/types';
import type { ConversationManager } from '../conversations/manager';
import type { Logger } from '../logging/logger';
import { resolveDefaultModel } from '../models/resolve';
import { executeOnboard, getOnboardStatus } from '../onboard';
import type { ShutdownManager, ShutdownMode } from '../shutdown/manager';
import type { TransportConnection } from '../transport/types';
import type {
	AgentDetails,
	AgentSummary,
	ChannelDetails,
	ChannelSummary,
	ConversationDetails,
	ConversationSummary,
	DaemonConfig,
	DaemonStatus,
	OnboardResult,
	OnboardStatus,
	RpcMethodName,
	RpcMethodResults,
	RpcMethods,
} from './methods';
import type { SubscriptionManager } from './subscriptions';

// =============================================================================
// Handler Types
// =============================================================================

/**
 * Generic RPC method handler.
 */
export type RpcMethodHandler<TParams = unknown, TResult = unknown> = (
	params: TParams,
	context: RpcHandlerContext,
) => Promise<TResult>;

/**
 * Context available to all RPC handlers.
 */
export interface RpcHandlerContext {
	/** Agent coordinator */
	coordinator: Coordinator;
	/** Channel registry */
	channelRegistry: ChannelRegistry;
	/** Conversation manager */
	conversationManager: ConversationManager;
	/** Daemon configuration */
	config: DaemonRuntimeConfig;
	/** Shutdown manager */
	shutdownManager: ShutdownManager;
	/** Subscription manager */
	subscriptionManager: SubscriptionManager;
	/** The connection making the request */
	connection: TransportConnection;
	/** Logger for the handler */
	logger: Logger;
	/** Model factory for creating adapters (optional for backward compat) */
	modelFactory?: ModelFactory;
	/** Application config for preferences and model resolution */
	appConfig?: Config;
	/** Tool registry for agents */
	toolRegistry?: ToolRegistryInterface;
}

/**
 * Daemon runtime configuration accessible to handlers.
 */
export interface DaemonRuntimeConfig {
	/** Socket path for IPC */
	socketPath: string;
	/** Storage path for persistence */
	storagePath: string;
	/** Path to guidance directory */
	guidancePath: string;
	/** Log level */
	logLevel: string;
	/** Daemon start time */
	startTime: number;
	/** Daemon version */
	version: string;
}

/**
 * Map of handler functions keyed by method name.
 */
export type RpcHandlers = {
	[K in RpcMethodName]: RpcMethodHandler<RpcMethods[K], RpcMethodResults[K]>;
};

// =============================================================================
// Handler Factory
// =============================================================================

/**
 * Create all RPC method handlers.
 *
 * @param baseContext - Base context without connection (connection is added per-request)
 * @returns Map of method names to handlers
 */
export function createHandlers(
	_baseContext: Omit<RpcHandlerContext, 'connection'>,
): Map<RpcMethodName, RpcMethodHandler> {
	const handlers = new Map<RpcMethodName, RpcMethodHandler>();

	// Daemon lifecycle
	handlers.set('daemon.status', (_params, ctx) => handleDaemonStatus(ctx));
	handlers.set('daemon.shutdown', (params, ctx) =>
		handleDaemonShutdown(params as RpcMethods['daemon.shutdown'], ctx),
	);
	handlers.set('daemon.ping', () => handleDaemonPing());
	handlers.set('daemon.reload', (_params, ctx) => handleDaemonReload(ctx));

	// Agent methods
	handlers.set('agent.list', (params, ctx) => handleAgentList(params as RpcMethods['agent.list'], ctx));
	handlers.set('agent.get', (params, ctx) => handleAgentGet(params as RpcMethods['agent.get'], ctx));
	handlers.set('agent.spawn', (params, ctx) => handleAgentSpawn(params as RpcMethods['agent.spawn'], ctx));
	handlers.set('agent.continue', (params, ctx) => handleAgentContinue(params as RpcMethods['agent.continue'], ctx));
	handlers.set('agent.terminate', (params, ctx) =>
		handleAgentTerminate(params as RpcMethods['agent.terminate'], ctx),
	);
	handlers.set('agent.pause', (params, ctx) => handleAgentPause(params as RpcMethods['agent.pause'], ctx));
	handlers.set('agent.resume', (params, ctx) => handleAgentResume(params as RpcMethods['agent.resume'], ctx));
	handlers.set('agent.send', (params, ctx) => handleAgentSend(params as RpcMethods['agent.send'], ctx));
	handlers.set('agent.snapshot', (params, ctx) => handleAgentSnapshot(params as RpcMethods['agent.snapshot'], ctx));
	handlers.set('agent.listCheckpoints', (_params, ctx) => handleListCheckpoints(ctx));

	// Channel methods
	handlers.set('channel.list', (_params, ctx) => handleChannelList(ctx));
	handlers.set('channel.get', (params, ctx) => handleChannelGet(params as RpcMethods['channel.get'], ctx));
	handlers.set('channel.connect', (params, ctx) =>
		handleChannelConnect(params as RpcMethods['channel.connect'], ctx),
	);
	handlers.set('channel.disconnect', (params, ctx) =>
		handleChannelDisconnect(params as RpcMethods['channel.disconnect'], ctx),
	);
	handlers.set('channel.reconnect', (params, ctx) =>
		handleChannelReconnect(params as RpcMethods['channel.reconnect'], ctx),
	);

	// Conversation methods
	handlers.set('conversation.list', (params, ctx) =>
		handleConversationList(params as RpcMethods['conversation.list'], ctx),
	);
	handlers.set('conversation.get', (params, ctx) =>
		handleConversationGet(params as RpcMethods['conversation.get'], ctx),
	);
	handlers.set('conversation.unbind', (params, ctx) =>
		handleConversationUnbind(params as RpcMethods['conversation.unbind'], ctx),
	);

	// Subscription methods
	handlers.set('subscribe.agents', (params, ctx) =>
		handleSubscribeAgents(params as RpcMethods['subscribe.agents'], ctx),
	);
	handlers.set('subscribe.agent.output', (params, ctx) =>
		handleSubscribeAgentOutput(params as RpcMethods['subscribe.agent.output'], ctx),
	);
	handlers.set('subscribe.channels', (_params, ctx) => handleSubscribeChannels(ctx));
	handlers.set('subscribe.logs', (params, ctx) => handleSubscribeLogs(params as RpcMethods['subscribe.logs'], ctx));
	handlers.set('unsubscribe', (params, ctx) => handleUnsubscribe(params as RpcMethods['unsubscribe'], ctx));

	// Configuration methods
	handlers.set('config.get', (_params, ctx) => handleConfigGet(ctx));
	handlers.set('config.validate', (params, ctx) =>
		handleConfigValidate(params as RpcMethods['config.validate'], ctx),
	);

	// Onboard methods
	handlers.set('onboard.status', (_params, ctx) => handleOnboardStatus(ctx));
	handlers.set('onboard.execute', (params, ctx) =>
		handleOnboardExecute(params as RpcMethods['onboard.execute'], ctx),
	);

	return handlers;
}

// =============================================================================
// Daemon Lifecycle Handlers
// =============================================================================

async function handleDaemonStatus(context: RpcHandlerContext): Promise<DaemonStatus> {
	const { coordinator, channelRegistry, config, shutdownManager } = context;

	const uptimeMs = Date.now() - config.startTime;
	const agentCount = coordinator.list().length;
	const channelCount = channelRegistry.list().length;

	return {
		status: shutdownManager.isShuttingDown ? 'stopping' : 'running',
		uptimeMs,
		agentCount,
		channelCount,
		version: config.version,
	};
}

async function handleDaemonShutdown(
	params: RpcMethods['daemon.shutdown'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['daemon.shutdown']> {
	const { shutdownManager, logger } = context;
	const mode: ShutdownMode = params.graceful !== false ? 'graceful' : 'hard';

	logger.info({ mode, timeoutMs: params.timeoutMs }, 'Shutdown requested via RPC');

	// Schedule shutdown asynchronously so we can return the response first
	setImmediate(() => {
		shutdownManager.execute(mode).catch((error) => {
			logger.error({ error }, 'Error during shutdown');
		});
	});

	return { ok: true };
}

async function handleDaemonPing(): Promise<RpcMethodResults['daemon.ping']> {
	return { pong: true };
}

async function handleDaemonReload(context: RpcHandlerContext): Promise<RpcMethodResults['daemon.reload']> {
	// Currently a stub - would reload configuration
	context.logger.info('Reload requested via RPC');
	return { reloaded: [] };
}

// =============================================================================
// Agent Handlers
// =============================================================================

async function handleAgentList(params: RpcMethods['agent.list'], context: RpcHandlerContext): Promise<AgentSummary[]> {
	const { coordinator } = context;
	const handles = coordinator.list(params.filter);

	return handles.map((handle) => ({
		id: handle.id,
		status: handle.status,
		tags: handle.config.tags,
		createdAt: handle.createdAt.toISOString(),
	}));
}

async function handleAgentGet(
	params: RpcMethods['agent.get'],
	context: RpcHandlerContext,
): Promise<AgentDetails | null> {
	const { coordinator } = context;
	const handle = coordinator.get(params.id);

	if (!handle) {
		return null;
	}

	return {
		id: handle.id,
		status: handle.status,
		tags: handle.config.tags,
		createdAt: handle.createdAt.toISOString(),
		guidancePath: handle.config.guidancePath,
		metadata: handle.config.metadata,
		parentId: handle.config.parentId,
	};
}

async function handleAgentSpawn(
	params: RpcMethods['agent.spawn'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['agent.spawn']> {
	const { coordinator, modelFactory, appConfig, logger } = context;

	if (!modelFactory) {
		throw new Error('Model factory not configured - cannot spawn agents');
	}

	// Resolve model: use explicit or fall back to default from preferences
	let model: string;
	if (params.model) {
		model = params.model;
	} else {
		if (!appConfig) {
			throw new Error('No model specified and app config not available for default resolution');
		}
		model = resolveDefaultModel(appConfig);
	}

	logger.info({ model, guidancePath: params.guidancePath, tags: params.tags }, 'Agent spawn requested');

	// Create adapter via model factory with optional thinking level override
	const adapter = await modelFactory.createAdapter(model, {
		thinkingLevel: params.thinkingLevel,
	});

	// Spawn the agent via coordinator
	const handle = await coordinator.spawn(adapter, {
		guidancePath: params.guidancePath,
		task: params.task,
		input: params.input,
		tags: params.tags,
	});

	logger.info({ agentId: handle.id, model }, 'Agent spawned');

	return { id: handle.id };
}

async function handleAgentTerminate(
	params: RpcMethods['agent.terminate'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['agent.terminate']> {
	const { coordinator, logger } = context;
	const handle = coordinator.get(params.id);

	if (!handle) {
		throw new Error(`Agent not found: ${params.id}`);
	}

	logger.info({ agentId: params.id, reason: params.reason }, 'Terminating agent');
	await handle.terminate(params.reason);

	return { ok: true };
}

async function handleAgentPause(
	params: RpcMethods['agent.pause'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['agent.pause']> {
	const { coordinator, logger } = context;
	const handle = coordinator.get(params.id);

	if (!handle) {
		throw new Error(`Agent not found: ${params.id}`);
	}

	logger.debug({ agentId: params.id }, 'Pausing agent');
	await handle.pause();

	return { ok: true };
}

async function handleAgentResume(
	params: RpcMethods['agent.resume'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['agent.resume']> {
	const { coordinator, logger } = context;
	const handle = coordinator.get(params.id);

	if (!handle) {
		throw new Error(`Agent not found: ${params.id}`);
	}

	logger.debug({ agentId: params.id }, 'Resuming agent');
	await handle.resume();

	return { ok: true };
}

async function handleAgentSend(
	params: RpcMethods['agent.send'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['agent.send']> {
	const { coordinator, logger } = context;
	const handle = coordinator.get(params.id);

	if (!handle) {
		throw new Error(`Agent not found: ${params.id}`);
	}

	logger.debug({ agentId: params.id }, 'Sending input to agent');
	await handle.send(params.input);

	return { ok: true };
}

async function handleAgentSnapshot(
	params: RpcMethods['agent.snapshot'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['agent.snapshot']> {
	const { coordinator } = context;
	const handle = coordinator.get(params.id);

	if (!handle) {
		throw new Error(`Agent not found: ${params.id}`);
	}

	return handle.snapshot();
}

async function handleAgentContinue(
	params: RpcMethods['agent.continue'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['agent.continue']> {
	const { coordinator, modelFactory, toolRegistry, logger } = context;

	if (!modelFactory) {
		throw new Error('Model factory not configured - cannot continue agents');
	}

	// Load checkpoint to get model info
	const checkpoint = await coordinator.loadCheckpoint(params.sessionId);
	if (!checkpoint) {
		throw new Error(`Checkpoint not found for session: ${params.sessionId}`);
	}

	// Determine model: use override if provided, else use checkpoint's model
	let modelIdentifier: string;
	if (params.model) {
		modelIdentifier = params.model;
	} else {
		const { provider, model } = checkpoint.adapterConfig;
		modelIdentifier = `${provider}/${model}`;
	}

	logger.info({ sessionId: params.sessionId, model: modelIdentifier }, 'Agent continue requested');

	// Create adapter via model factory
	const adapter = await modelFactory.createAdapter(modelIdentifier, {
		thinkingLevel: checkpoint.adapterConfig.thinkingLevel as
			| 'off'
			| 'minimal'
			| 'low'
			| 'medium'
			| 'high'
			| undefined,
	});

	// Continue the session via coordinator
	const handle = await coordinator.continue(params.sessionId, params.input, adapter, {
		tools: toolRegistry,
	});

	logger.info({ sessionId: handle.id, model: modelIdentifier }, 'Agent continued');

	return { id: handle.id };
}

async function handleListCheckpoints(context: RpcHandlerContext): Promise<RpcMethodResults['agent.listCheckpoints']> {
	const { coordinator } = context;
	return coordinator.listCheckpoints();
}

// =============================================================================
// Channel Handlers
// =============================================================================

async function handleChannelList(context: RpcHandlerContext): Promise<ChannelSummary[]> {
	const { channelRegistry } = context;
	const channels = channelRegistry.list();

	return channels.map((channel) => ({
		id: channel.id,
		type: channel.adapter,
		status: channel.status,
	}));
}

async function handleChannelGet(
	params: RpcMethods['channel.get'],
	context: RpcHandlerContext,
): Promise<ChannelDetails | null> {
	const { channelRegistry } = context;
	const channel = channelRegistry.get(params.id);

	if (!channel) {
		return null;
	}

	return {
		id: channel.id,
		type: channel.adapter,
		status: channel.status,
	};
}

async function handleChannelConnect(
	params: RpcMethods['channel.connect'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['channel.connect']> {
	// This is a stub - full implementation requires channel adapter factory
	context.logger.info({ type: params.type }, 'Channel connect requested');
	throw new Error('channel.connect requires channel adapter factory - not implemented in RPC layer');
}

async function handleChannelDisconnect(
	params: RpcMethods['channel.disconnect'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['channel.disconnect']> {
	const { channelRegistry, logger } = context;
	const channel = channelRegistry.get(params.id);

	if (!channel) {
		throw new Error(`Channel not found: ${params.id}`);
	}

	logger.info({ channelId: params.id }, 'Disconnecting channel');
	await channel.disconnect();

	return { ok: true };
}

async function handleChannelReconnect(
	params: RpcMethods['channel.reconnect'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['channel.reconnect']> {
	const { channelRegistry, logger } = context;
	const channel = channelRegistry.get(params.id);

	if (!channel) {
		throw new Error(`Channel not found: ${params.id}`);
	}

	logger.info({ channelId: params.id }, 'Reconnecting channel');
	await channel.disconnect();
	await channel.connect();

	return { ok: true };
}

// =============================================================================
// Conversation Handlers
// =============================================================================

async function handleConversationList(
	params: RpcMethods['conversation.list'],
	context: RpcHandlerContext,
): Promise<ConversationSummary[]> {
	const { conversationManager } = context;
	const bindings = conversationManager.list(params.filter);

	return bindings.map((binding) => ({
		destination: binding.destination,
		agentId: binding.agentId,
		createdAt: binding.createdAt.toISOString(),
		lastActivityAt: binding.lastActivityAt.toISOString(),
	}));
}

async function handleConversationGet(
	params: RpcMethods['conversation.get'],
	context: RpcHandlerContext,
): Promise<ConversationDetails | null> {
	const { conversationManager } = context;
	const binding = conversationManager.getByDestination(params.destination);

	if (!binding) {
		return null;
	}

	return {
		destination: binding.destination,
		agentId: binding.agentId,
		createdAt: binding.createdAt.toISOString(),
		lastActivityAt: binding.lastActivityAt.toISOString(),
		binding,
	};
}

async function handleConversationUnbind(
	params: RpcMethods['conversation.unbind'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['conversation.unbind']> {
	const { conversationManager, logger } = context;

	logger.info({ destination: params.destination }, 'Unbinding conversation');
	conversationManager.unbind(params.destination);

	return { ok: true };
}

// =============================================================================
// Subscription Handlers
// =============================================================================

async function handleSubscribeAgents(
	params: RpcMethods['subscribe.agents'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['subscribe.agents']> {
	const { subscriptionManager, connection } = context;
	const subscriptionId = subscriptionManager.subscribe(connection.id, 'agents', params.filter);
	return { subscriptionId };
}

async function handleSubscribeAgentOutput(
	params: RpcMethods['subscribe.agent.output'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['subscribe.agent.output']> {
	const { subscriptionManager, connection, coordinator } = context;

	// Verify agent exists
	const handle = coordinator.get(params.id);
	if (!handle) {
		throw new Error(`Agent not found: ${params.id}`);
	}

	const subscriptionId = subscriptionManager.subscribe(connection.id, 'agent.output', { agentId: params.id });
	return { subscriptionId };
}

async function handleSubscribeChannels(context: RpcHandlerContext): Promise<RpcMethodResults['subscribe.channels']> {
	const { subscriptionManager, connection } = context;
	const subscriptionId = subscriptionManager.subscribe(connection.id, 'channels');
	return { subscriptionId };
}

async function handleSubscribeLogs(
	params: RpcMethods['subscribe.logs'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['subscribe.logs']> {
	const { subscriptionManager, connection } = context;
	const subscriptionId = subscriptionManager.subscribe(connection.id, 'logs', { level: params.level });
	return { subscriptionId };
}

async function handleUnsubscribe(
	params: RpcMethods['unsubscribe'],
	context: RpcHandlerContext,
): Promise<RpcMethodResults['unsubscribe']> {
	const { subscriptionManager, connection, logger } = context;

	// Verify the subscription belongs to this connection
	const subscription = subscriptionManager.get(params.subscriptionId);
	if (!subscription) {
		throw new Error(`Subscription not found: ${params.subscriptionId}`);
	}

	if (subscription.connectionId !== connection.id) {
		throw new Error("Cannot unsubscribe from another connection's subscription");
	}

	logger.debug({ subscriptionId: params.subscriptionId }, 'Unsubscribing');
	subscriptionManager.unsubscribe(params.subscriptionId);

	return { ok: true };
}

// =============================================================================
// Configuration Handlers
// =============================================================================

async function handleConfigGet(context: RpcHandlerContext): Promise<DaemonConfig> {
	const { config } = context;

	return {
		socketPath: config.socketPath,
		storagePath: config.storagePath,
		logLevel: config.logLevel,
	};
}

async function handleConfigValidate(
	params: RpcMethods['config.validate'],
	_context: RpcHandlerContext,
): Promise<RpcMethodResults['config.validate']> {
	// Basic configuration validation
	const errors: string[] = [];

	if (params.config.socketPath !== undefined && typeof params.config.socketPath !== 'string') {
		errors.push('socketPath must be a string');
	}

	if (params.config.storagePath !== undefined && typeof params.config.storagePath !== 'string') {
		errors.push('storagePath must be a string');
	}

	if (params.config.logLevel !== undefined) {
		const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
		if (!validLevels.includes(params.config.logLevel as string)) {
			errors.push(`logLevel must be one of: ${validLevels.join(', ')}`);
		}
	}

	return {
		valid: errors.length === 0,
		errors: errors.length > 0 ? errors : undefined,
	};
}

// =============================================================================
// Onboard Handlers
// =============================================================================

async function handleOnboardStatus(context: RpcHandlerContext): Promise<OnboardStatus> {
	const { config, logger } = context;

	return getOnboardStatus({
		guidancePath: config.guidancePath,
		logger,
	});
}

async function handleOnboardExecute(
	params: RpcMethods['onboard.execute'],
	context: RpcHandlerContext,
): Promise<OnboardResult> {
	const { config, logger } = context;

	return executeOnboard(
		{
			guidancePath: config.guidancePath,
			logger,
		},
		{
			backup: params.backup,
			dryRun: params.dryRun,
		},
	);
}
