/**
 * ConversationManager for managing conversation bindings.
 *
 * The ConversationManager is responsible for:
 * - Tracking mappings between channel destinations and agents
 * - Managing conversation lifecycle and bindings
 * - Providing fast lookups by destination or agent
 * - Coordinating with the persistence store
 */

import type { Destination } from '@geniigotchi/comms/destination/types';
import type { AgentSessionId } from '@geniigotchi/orchestrator/types/core';
import type { Logger } from '../logging/logger';
import type { ConversationStore } from './store';
import type { ConversationBinding, ConversationFilter } from './types';

/**
 * Create a composite key from a destination for Map lookups.
 */
function destinationKey(destination: Destination): string {
	return `${destination.channelId}:${destination.ref}`;
}

/**
 * ConversationManager interface for managing conversation bindings.
 */
export interface ConversationManagerInterface {
	/**
	 * Get an existing binding or create a new one for the destination.
	 *
	 * @param destination - The destination to get or create a binding for
	 * @returns The existing or newly created binding
	 */
	getOrCreate(destination: Destination): ConversationBinding;

	/**
	 * Bind an agent to a destination.
	 *
	 * Creates the binding if it doesn't exist and updates lastActivityAt.
	 *
	 * @param destination - The destination to bind
	 * @param agentId - The agent session ID to bind
	 */
	bind(destination: Destination, agentId: AgentSessionId): void;

	/**
	 * Unbind the agent from a destination.
	 *
	 * Sets agentId to null but keeps the binding for history.
	 *
	 * @param destination - The destination to unbind
	 */
	unbind(destination: Destination): void;

	/**
	 * Get a binding by destination.
	 *
	 * @param destination - The destination to look up
	 * @returns The binding or undefined if not found
	 */
	getByDestination(destination: Destination): ConversationBinding | undefined;

	/**
	 * Get a binding by agent ID.
	 *
	 * @param agentId - The agent session ID to look up
	 * @returns The binding or undefined if not found
	 */
	getByAgent(agentId: AgentSessionId): ConversationBinding | undefined;

	/**
	 * List all bindings matching the optional filter.
	 *
	 * @param filter - Optional filter criteria
	 * @returns Array of matching bindings
	 */
	list(filter?: ConversationFilter): ConversationBinding[];

	/**
	 * Get a snapshot of all current bindings for persistence.
	 *
	 * @returns Array of all bindings
	 */
	snapshot(): ConversationBinding[];

	/**
	 * Restore bindings from a previously saved snapshot.
	 *
	 * @param bindings - Array of bindings to restore
	 */
	restore(bindings: ConversationBinding[]): void;
}

/**
 * ConversationManager manages conversation bindings between destinations and agents.
 */
export class ConversationManager implements ConversationManagerInterface {
	private readonly _logger: Logger;
	private readonly _store: ConversationStore | null;

	/** Map from destination key (channelId:ref) to binding */
	private readonly _byDestination: Map<string, ConversationBinding> = new Map();

	/** Map from agentId to destination key for reverse lookups */
	private readonly _byAgent: Map<AgentSessionId, string> = new Map();

	constructor(logger: Logger, store?: ConversationStore) {
		this._logger = logger.child({ component: 'ConversationManager' });
		this._store = store ?? null;
	}

	/**
	 * Start the conversation manager.
	 *
	 * Loads persisted bindings from the store if available.
	 */
	async start(): Promise<void> {
		this._logger.info('Starting conversation manager');

		if (this._store) {
			try {
				const bindings = await this._store.load();
				this.restore(bindings);
				this._logger.info({ count: bindings.length }, 'Loaded persisted bindings');
			} catch (error) {
				this._logger.warn({ error }, 'Failed to load persisted bindings, starting fresh');
			}
		}
	}

	/**
	 * Stop the conversation manager.
	 *
	 * Persists all bindings before shutdown.
	 */
	async stop(): Promise<void> {
		this._logger.info('Stopping conversation manager');

		if (this._store) {
			try {
				const bindings = this.snapshot();
				await this._store.save(bindings);
				this._logger.info({ count: bindings.length }, 'Persisted bindings');
			} catch (error) {
				this._logger.error({ error }, 'Failed to persist bindings');
			}
		}

		this._byDestination.clear();
		this._byAgent.clear();
	}

	getOrCreate(destination: Destination): ConversationBinding {
		const key = destinationKey(destination);
		let binding = this._byDestination.get(key);

		if (!binding) {
			const now = new Date();
			binding = {
				destination,
				agentId: null,
				createdAt: now,
				lastActivityAt: now,
			};
			this._byDestination.set(key, binding);
			this._logger.debug({ destination: key }, 'Created new binding');
		}

		return binding;
	}

	bind(destination: Destination, agentId: AgentSessionId): void {
		const binding = this.getOrCreate(destination);
		const key = destinationKey(destination);

		// Remove old agent mapping if there was one
		if (binding.agentId !== null) {
			this._byAgent.delete(binding.agentId);
		}

		// Update binding
		binding.agentId = agentId;
		binding.lastActivityAt = new Date();

		// Add new agent mapping
		this._byAgent.set(agentId, key);

		this._logger.debug({ destination: key, agentId }, 'Bound agent to destination');
	}

	unbind(destination: Destination): void {
		const key = destinationKey(destination);
		const binding = this._byDestination.get(key);

		if (binding && binding.agentId !== null) {
			// Remove agent mapping
			this._byAgent.delete(binding.agentId);

			// Clear agent from binding but keep the binding itself
			binding.agentId = null;

			this._logger.debug({ destination: key }, 'Unbound agent from destination');
		}
	}

	getByDestination(destination: Destination): ConversationBinding | undefined {
		const key = destinationKey(destination);
		return this._byDestination.get(key);
	}

	getByAgent(agentId: AgentSessionId): ConversationBinding | undefined {
		const key = this._byAgent.get(agentId);
		if (key === undefined) {
			return undefined;
		}
		return this._byDestination.get(key);
	}

	list(filter?: ConversationFilter): ConversationBinding[] {
		const bindings = Array.from(this._byDestination.values());

		if (!filter) {
			return bindings;
		}

		return bindings.filter((binding) => {
			// Filter by channelId
			if (filter.channelId !== undefined && binding.destination.channelId !== filter.channelId) {
				return false;
			}

			// Filter by hasAgent
			if (filter.hasAgent !== undefined) {
				const hasAgent = binding.agentId !== null;
				if (filter.hasAgent !== hasAgent) {
					return false;
				}
			}

			return true;
		});
	}

	snapshot(): ConversationBinding[] {
		return Array.from(this._byDestination.values());
	}

	restore(bindings: ConversationBinding[]): void {
		// Clear existing state
		this._byDestination.clear();
		this._byAgent.clear();

		// Restore bindings
		for (const binding of bindings) {
			const key = destinationKey(binding.destination);
			this._byDestination.set(key, binding);

			if (binding.agentId !== null) {
				this._byAgent.set(binding.agentId, key);
			}
		}

		this._logger.debug({ count: bindings.length }, 'Restored bindings');
	}

	/**
	 * Get the count of active bindings (with an agent bound).
	 */
	get activeCount(): number {
		return this._byAgent.size;
	}

	/**
	 * Get the total count of all bindings.
	 */
	get totalCount(): number {
		return this._byDestination.size;
	}
}

/**
 * Create a new ConversationManager instance.
 *
 * @param logger - Logger instance for logging
 * @param store - Optional persistence store
 * @returns A new ConversationManager
 */
export function createConversationManager(logger: Logger, store?: ConversationStore): ConversationManager {
	return new ConversationManager(logger, store);
}
