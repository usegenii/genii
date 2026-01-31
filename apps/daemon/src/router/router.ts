/**
 * MessageRouter implementation for routing events between channels and agents.
 *
 * The MessageRouter is responsible for:
 * - Receiving inbound events from communication channels
 * - Transforming events into agent inputs
 * - Routing agent outputs back to appropriate channels
 * - Managing event subscriptions and delivery
 */

import type { Destination } from '@geniigotchi/comms/destination/types';
import type { InboundEvent } from '@geniigotchi/comms/events/types';
import type { ChannelRegistry } from '@geniigotchi/comms/registry/types';
import type { ChannelId, Disposable } from '@geniigotchi/comms/types/core';
import type { AgentAdapter } from '@geniigotchi/orchestrator/adapters/types';
import type { Coordinator } from '@geniigotchi/orchestrator/coordinator/types';
import type { AgentEvent, CoordinatorEvent } from '@geniigotchi/orchestrator/events/types';
import type { Tool, ToolRegistryInterface } from '@geniigotchi/orchestrator/tools/types';
import type { AgentInput, AgentSessionId, AgentSpawnConfig } from '@geniigotchi/orchestrator/types/core';
import type { ConversationManager } from '../conversations/manager';
import type { Logger } from '../logging/logger';
import { agentEventToOutboundIntent, inboundEventToAgentInput } from './transforms';

/**
 * Create an empty tool registry for agents with no tools.
 */
function createEmptyToolRegistry(): ToolRegistryInterface {
	return {
		register: <TInput, TOutput>(_tool: Tool<TInput, TOutput>): void => {
			// No-op for empty registry
		},
		get: (_name: string): Tool<unknown, unknown> | undefined => undefined,
		all: (): Tool<unknown, unknown>[] => [],
		byCategory: (_category: string): Tool<unknown, unknown>[] => [],
		extend: (registry: ToolRegistryInterface): ToolRegistryInterface => registry,
	};
}

/**
 * Configuration for spawning new agents.
 */
export interface AgentSpawnContext {
	/** Path to guidance folder */
	guidancePath: string;
	/** Tags to apply to spawned agents */
	tags?: string[];
	/** Metadata to attach */
	metadata?: Record<string, unknown>;
}

/**
 * Factory function for creating agent adapters.
 * Returns a Promise since adapter creation may require async operations
 * like resolving secrets from a secret store.
 */
export type AgentAdapterFactory = (agentId: AgentSessionId) => Promise<AgentAdapter>;

/**
 * Configuration for the MessageRouter.
 */
export interface MessageRouterConfig {
	/** Coordinator for managing agents */
	coordinator: Coordinator;
	/** Channel registry for accessing channels */
	channelRegistry: ChannelRegistry;
	/** Conversation manager for bindings */
	conversationManager: ConversationManager;
	/** Factory for creating agent adapters */
	adapterFactory: AgentAdapterFactory;
	/** Default spawn configuration */
	defaultSpawnContext: AgentSpawnContext;
	/** Logger instance */
	logger: Logger;
}

/**
 * MessageRouter interface for routing events between channels and agents.
 */
export interface MessageRouterInterface {
	/**
	 * Handle an inbound event from a channel.
	 *
	 * @param event - The inbound event to handle
	 * @param channelId - The channel the event came from
	 */
	handleInbound(event: InboundEvent, channelId: ChannelId): Promise<void>;

	/**
	 * Handle an event from an agent.
	 *
	 * @param agentId - The agent that emitted the event
	 * @param event - The agent event
	 */
	handleAgentEvent(agentId: AgentSessionId, event: AgentEvent): Promise<void>;

	/**
	 * Start the message router.
	 */
	start(): Promise<void>;

	/**
	 * Stop the message router.
	 */
	stop(): Promise<void>;
}

/**
 * MessageRouter routes events between channels and agents.
 */
export class MessageRouter implements MessageRouterInterface {
	private readonly _logger: Logger;
	private readonly _coordinator: Coordinator;
	private readonly _channelRegistry: ChannelRegistry;
	private readonly _conversationManager: ConversationManager;
	private readonly _adapterFactory: AgentAdapterFactory;
	private readonly _defaultSpawnContext: AgentSpawnContext;

	/** Subscriptions to clean up on stop */
	private readonly _subscriptions: Disposable[] = [];

	/** Whether the router is running */
	private _running = false;

	constructor(config: MessageRouterConfig) {
		this._logger = config.logger.child({ component: 'MessageRouter' });
		this._coordinator = config.coordinator;
		this._channelRegistry = config.channelRegistry;
		this._conversationManager = config.conversationManager;
		this._adapterFactory = config.adapterFactory;
		this._defaultSpawnContext = config.defaultSpawnContext;
	}

	/**
	 * Start the message router.
	 *
	 * Subscribes to all registered channels and begins routing events.
	 */
	async start(): Promise<void> {
		if (this._running) {
			this._logger.warn('MessageRouter is already running');
			return;
		}

		this._logger.info('Starting message router');

		// Subscribe to channel registry events
		const channelUnsubscribe = this._channelRegistry.subscribe((event, channelId) => {
			this.handleInbound(event, channelId).catch((error) => {
				this._logger.error({ error, channelId }, 'Error handling inbound event');
			});
		});
		this._subscriptions.push(channelUnsubscribe);

		// Subscribe to coordinator events
		const coordinatorUnsubscribe = this._coordinator.subscribe((event) => {
			this._handleCoordinatorEvent(event).catch((error) => {
				this._logger.error({ error }, 'Error handling coordinator event');
			});
		});
		this._subscriptions.push(coordinatorUnsubscribe);

		this._running = true;
		this._logger.info('Message router started');
	}

	/**
	 * Stop the message router.
	 *
	 * Unsubscribes from all channels and stops event routing.
	 */
	async stop(): Promise<void> {
		if (!this._running) {
			this._logger.warn('MessageRouter is not running');
			return;
		}

		this._logger.info('Stopping message router');

		// Unsubscribe from all subscriptions
		for (const unsubscribe of this._subscriptions) {
			unsubscribe();
		}
		this._subscriptions.length = 0;

		this._running = false;
		this._logger.info('Message router stopped');
	}

	/**
	 * Handle an inbound event from a channel.
	 *
	 * @param event - The inbound event to handle
	 * @param channelId - The channel the event came from
	 */
	async handleInbound(event: InboundEvent, channelId: ChannelId): Promise<void> {
		this._logger.debug({ eventType: event.type, channelId }, 'Handling inbound event');

		// Transform the event to agent input
		const agentInput = inboundEventToAgentInput(event);
		if (agentInput === null) {
			this._logger.debug({ eventType: event.type }, 'Event does not produce agent input, skipping');
			return;
		}

		// Get or create conversation binding for this destination
		const destination = event.origin;
		const binding = this._conversationManager.getOrCreate(destination);

		// If no agent is bound, spawn a new one with the initial input
		if (binding.agentId === null) {
			const agentId = await this._spawnAgent(channelId, {
				message: agentInput.message,
				context: agentInput.context,
			});
			this._conversationManager.bind(destination, agentId);
			this._logger.info(
				{ agentId, destination: `${destination.channelId}:${destination.ref}` },
				'Spawned and bound new agent',
			);
			// Input was passed at spawn time, no need to send separately
			return;
		}

		// Agent already exists - check if we can send follow-up or need to continue from checkpoint
		const agentId = binding.agentId;
		const agentHandle = this._coordinator.get(agentId);

		const input: AgentInput = {
			message: agentInput.message,
			context: agentInput.context,
		};

		// Agent handle not found - might be after a restart. Try to continue from checkpoint.
		if (agentHandle === undefined) {
			await this._tryRestoreFromCheckpoint(agentId, input, destination, channelId);
			return;
		}

		// If agent is completed, continue from checkpoint to restore message history
		if (agentHandle.status === 'completed') {
			const adapter = this._coordinator.getAdapter(agentId);
			if (adapter === undefined) {
				this._logger.error({ agentId }, 'No adapter found for completed agent, cannot continue');
				this._conversationManager.unbind(destination);
				return;
			}

			try {
				// Continue the session from checkpoint - this restores message history
				const newHandle = await this._coordinator.continue(agentId, input, adapter);
				this._logger.info(
					{ agentId: newHandle.id, message: agentInput.message.substring(0, 50) },
					'Continued conversation from checkpoint',
				);
			} catch (error) {
				this._logger.error({ error, agentId }, 'Error continuing conversation from checkpoint');
				// Unbind on error so next message will spawn fresh agent
				this._conversationManager.unbind(destination);
			}
			return;
		}

		// Agent is still running - send follow-up input directly
		try {
			await agentHandle.send(input);
			this._logger.debug({ agentId, message: agentInput.message.substring(0, 50) }, 'Sent input to agent');
		} catch (error) {
			this._logger.error({ error, agentId }, 'Error sending input to agent');
		}
	}

	/**
	 * Handle an event from an agent.
	 *
	 * @param agentId - The agent that emitted the event
	 * @param event - The agent event
	 */
	async handleAgentEvent(agentId: AgentSessionId, event: AgentEvent): Promise<void> {
		this._logger.debug({ agentId, eventType: event.type }, 'Handling agent event');

		// Log agent output for debugging
		if (event.type === 'output') {
			this._logger.debug({ agentId, text: event.text, final: event.final }, 'Agent output');
		} else if (event.type === 'done') {
			this._logger.debug({ agentId, result: event.result }, 'Agent done');
		} else if (event.type === 'error') {
			this._logger.debug({ agentId, error: event.error, fatal: event.fatal }, 'Agent error');
		} else if (event.type === 'thought') {
			this._logger.debug({ agentId, thought: event.content }, 'Agent thought');
		}

		// Get the conversation binding for this agent
		const binding = this._conversationManager.getByAgent(agentId);
		if (binding === undefined) {
			this._logger.warn({ agentId }, 'No conversation binding found for agent');
			return;
		}

		// Transform the agent event to outbound intent
		const intent = agentEventToOutboundIntent(event, binding.destination);
		if (intent === null) {
			this._logger.debug({ eventType: event.type }, 'Event does not produce outbound intent');
			return;
		}

		// Send the intent to the appropriate channel
		const channelId = binding.destination.channelId;
		try {
			await this._channelRegistry.process(channelId, intent);
			this._logger.debug({ channelId, intentType: intent.type }, 'Sent intent to channel');
		} catch (error) {
			this._logger.error({ error, channelId, intentType: intent.type }, 'Error sending intent to channel');
		}
	}

	/**
	 * Handle a coordinator event.
	 */
	private async _handleCoordinatorEvent(event: CoordinatorEvent): Promise<void> {
		switch (event.type) {
			case 'agent_event': {
				await this.handleAgentEvent(event.sessionId, event.event);
				break;
			}
			case 'agent_done': {
				// Agent turn completed - keep binding for conversation continuity
				// The binding remains so follow-up messages continue the same session
				const binding = this._conversationManager.getByAgent(event.sessionId);
				if (binding !== undefined) {
					this._logger.debug(
						{
							agentId: event.sessionId,
							destination: `${binding.destination.channelId}:${binding.destination.ref}`,
						},
						'Agent turn completed, keeping conversation binding',
					);
				}
				break;
			}
			case 'agent_spawned': {
				// Agent spawned - handled by handleInbound
				this._logger.debug({ agentId: event.sessionId }, 'Agent spawned');
				break;
			}
		}
	}

	/**
	 * Try to restore an agent from checkpoint after daemon restart.
	 *
	 * When the daemon restarts, conversation bindings are restored but agents aren't
	 * in the coordinator anymore. This method tries to continue from the checkpoint.
	 *
	 * @param agentId - The agent ID from the binding
	 * @param input - The input to send
	 * @param destination - The destination for unbinding on failure
	 * @param channelId - The channel for spawning a new agent if needed
	 */
	private async _tryRestoreFromCheckpoint(
		agentId: AgentSessionId,
		input: AgentInput,
		destination: Destination,
		channelId: ChannelId,
	): Promise<void> {
		// Check if there's a checkpoint we can restore from
		const checkpoint = await this._coordinator.loadCheckpoint(agentId);
		if (checkpoint === null) {
			this._logger.info({ agentId }, 'No checkpoint found for agent after restart, spawning new agent');
			// No checkpoint - unbind and spawn a fresh agent
			this._conversationManager.unbind(destination);
			const newAgentId = await this._spawnAgent(channelId, input);
			this._conversationManager.bind(destination, newAgentId);
			this._logger.info(
				{ newAgentId, destination: `${destination.channelId}:${destination.ref}` },
				'Spawned new agent to replace missing one',
			);
			return;
		}

		// Create a new adapter for the restored agent
		try {
			const adapter = await this._adapterFactory(agentId);
			const newHandle = await this._coordinator.continue(agentId, input, adapter);
			this._logger.info(
				{ agentId: newHandle.id, message: input.message?.substring(0, 50) },
				'Restored conversation from checkpoint after restart',
			);
		} catch (error) {
			this._logger.error({ error, agentId }, 'Failed to restore from checkpoint, spawning new agent');
			// Failed to restore - unbind and spawn fresh
			this._conversationManager.unbind(destination);
			const newAgentId = await this._spawnAgent(channelId, input);
			this._conversationManager.bind(destination, newAgentId);
		}
	}

	/**
	 * Spawn a new agent.
	 *
	 * @param channelId - The channel the agent is being spawned for
	 * @param input - Optional initial input to queue before the agent starts
	 */
	private async _spawnAgent(channelId: ChannelId, input?: AgentInput): Promise<AgentSessionId> {
		// Create a temporary session ID for the adapter factory
		const tempId = crypto.randomUUID() as AgentSessionId;
		const adapter = await this._adapterFactory(tempId);

		const spawnConfig: AgentSpawnConfig = {
			guidancePath: this._defaultSpawnContext.guidancePath,
			tags: [...(this._defaultSpawnContext.tags ?? []), `channel:${channelId}`],
			metadata: {
				...this._defaultSpawnContext.metadata,
				channelId,
			},
			tools: createEmptyToolRegistry(),
			input,
		};

		const handle = await this._coordinator.spawn(adapter, spawnConfig);
		return handle.id;
	}
}

/**
 * Create a new MessageRouter instance.
 *
 * @param config - Configuration for the router
 * @returns A new MessageRouter
 */
export function createMessageRouter(config: MessageRouterConfig): MessageRouter {
	return new MessageRouter(config);
}
