/**
 * Subscription manager for handling RPC subscriptions.
 *
 * The subscription manager provides:
 * - Subscription lifecycle management
 * - Per-connection subscription tracking
 * - Event notification dispatch
 * - Automatic cleanup on connection close
 */

import type { AgentOutputRecord, LogEntry, RpcMethods } from '@genii/lib/rpc/methods';
import { createLogBuffer, type LogBuffer, matchesLogFilter } from '../logging/buffer';
import type { Logger } from '../logging/logger';
import type { RpcNotification, TransportConnection } from '../transport/types';
import { type AgentEventJournal, createAgentEventJournal } from './event-journal';

/**
 * Types of subscriptions supported.
 */
export type SubscriptionType = 'agents' | 'agent.output' | 'channels' | 'logs';

/**
 * Subscription entry stored by the manager.
 */
export interface Subscription {
	/** Unique subscription ID */
	id: string;
	/** Connection ID that owns this subscription */
	connectionId: string;
	/** Type of subscription */
	type: SubscriptionType;
	/** Optional filter for the subscription */
	filter?: unknown;
	/** Timestamp when created */
	createdAt: Date;
}

/**
 * Interface for the subscription manager.
 */
export interface SubscriptionManager {
	/**
	 * Create a new subscription.
	 *
	 * @param connectionId - ID of the connection owning the subscription
	 * @param type - Type of subscription
	 * @param filter - Optional filter for the subscription
	 * @returns Unique subscription ID
	 */
	subscribe(connectionId: string, type: SubscriptionType, filter?: unknown): string;

	/**
	 * Remove a subscription.
	 *
	 * @param subscriptionId - ID of the subscription to remove
	 * @returns true if the subscription was removed, false if not found
	 */
	unsubscribe(subscriptionId: string): boolean;

	/**
	 * Get all subscriptions for a connection.
	 *
	 * @param connectionId - ID of the connection
	 * @returns Array of subscription IDs
	 */
	getSubscriptions(connectionId: string): string[];

	/**
	 * Get a subscription by ID.
	 *
	 * @param subscriptionId - ID of the subscription
	 * @returns The subscription or undefined if not found
	 */
	get(subscriptionId: string): Subscription | undefined;

	/** Notify only subscriptions for the agent contained in the record. */
	notifyAgentOutput(record: AgentOutputRecord): void;

	/** Notify log subscriptions whose live filters match the entry. */
	notifyLog(entry: LogEntry): void;

	/** Get retained output for an agent before switching to live notifications. */
	getAgentEvents(agentId: AgentOutputRecord['agentId']): AgentOutputRecord[];

	/** Get retained daemon logs matching the subscription request. */
	getLogEntries(filter: RpcMethods['subscribe.logs']): LogEntry[];

	/**
	 * Clean up all subscriptions for a connection.
	 *
	 * @param connectionId - ID of the connection to clean up
	 */
	cleanup(connectionId: string): void;

	/**
	 * Get the count of active subscriptions.
	 */
	readonly count: number;
}

/**
 * Configuration for the subscription manager.
 */
export interface SubscriptionManagerConfig {
	/** Logger instance */
	logger: Logger;
	/** Function to get a connection by ID for sending notifications */
	getConnection: (connectionId: string) => TransportConnection | undefined;
	/** Shared retained agent event journal */
	agentEvents?: AgentEventJournal;
	/** Shared retained daemon log buffer */
	logs?: LogBuffer;
}

/**
 * Implementation of the subscription manager.
 */
class SubscriptionManagerImpl implements SubscriptionManager {
	private readonly _logger: Logger;
	private readonly _getConnection: (connectionId: string) => TransportConnection | undefined;
	private readonly _agentEvents: AgentEventJournal;
	private readonly _logs: LogBuffer;

	/** All subscriptions by ID */
	private readonly _subscriptions: Map<string, Subscription> = new Map();

	/** Subscriptions grouped by connection ID */
	private readonly _byConnection: Map<string, Set<string>> = new Map();

	/** Subscriptions grouped by type */
	private readonly _byType: Map<SubscriptionType, Set<string>> = new Map();

	/** Counter for generating subscription IDs */
	private _nextId = 1;

	constructor(config: SubscriptionManagerConfig) {
		this._logger = config.logger.child({ component: 'SubscriptionManager' });
		this._getConnection = config.getConnection;
		this._agentEvents = config.agentEvents ?? createAgentEventJournal();
		this._logs = config.logs ?? createLogBuffer();

		// Initialize type maps
		for (const type of ['agents', 'agent.output', 'channels', 'logs'] as SubscriptionType[]) {
			this._byType.set(type, new Set());
		}
	}

	subscribe(connectionId: string, type: SubscriptionType, filter?: unknown): string {
		const id = `sub-${this._nextId++}`;
		const subscription: Subscription = {
			id,
			connectionId,
			type,
			filter,
			createdAt: new Date(),
		};

		// Store the subscription
		this._subscriptions.set(id, subscription);

		// Add to connection index
		let connectionSubs = this._byConnection.get(connectionId);
		if (!connectionSubs) {
			connectionSubs = new Set();
			this._byConnection.set(connectionId, connectionSubs);
		}
		connectionSubs.add(id);

		// Add to type index
		const typeSubs = this._byType.get(type);
		if (typeSubs) {
			typeSubs.add(id);
		}

		this._logger.debug({ subscriptionId: id, connectionId, type }, 'Created subscription');
		return id;
	}

	unsubscribe(subscriptionId: string): boolean {
		const subscription = this._subscriptions.get(subscriptionId);
		if (!subscription) {
			return false;
		}

		// Remove from main storage
		this._subscriptions.delete(subscriptionId);

		// Remove from connection index
		const connectionSubs = this._byConnection.get(subscription.connectionId);
		if (connectionSubs) {
			connectionSubs.delete(subscriptionId);
			if (connectionSubs.size === 0) {
				this._byConnection.delete(subscription.connectionId);
			}
		}

		// Remove from type index
		const typeSubs = this._byType.get(subscription.type);
		if (typeSubs) {
			typeSubs.delete(subscriptionId);
		}

		this._logger.debug({ subscriptionId }, 'Removed subscription');
		return true;
	}

	getSubscriptions(connectionId: string): string[] {
		const subs = this._byConnection.get(connectionId);
		return subs ? Array.from(subs) : [];
	}

	get(subscriptionId: string): Subscription | undefined {
		return this._subscriptions.get(subscriptionId);
	}

	notifyAgentOutput(record: AgentOutputRecord): void {
		const typeSubs = this._byType.get('agent.output');
		if (!typeSubs || typeSubs.size === 0) {
			return;
		}

		for (const subId of typeSubs) {
			const subscription = this._subscriptions.get(subId);
			if (!subscription) {
				continue;
			}
			const filter = subscription.filter as { agentId?: unknown } | undefined;
			if (filter?.agentId !== record.agentId) {
				continue;
			}

			const connection = this._getConnection(subscription.connectionId);
			if (connection) {
				try {
					const notification: RpcNotification = {
						method: 'agent.output',
						params: { subscriptionId: subId, ...record },
					};
					connection.notify(notification);
				} catch {
					// Connection lifecycle cleanup owns removal; never log from publication paths.
				}
			}
		}
	}

	notifyLog(entry: LogEntry): void {
		const typeSubs = this._byType.get('logs');
		if (!typeSubs || typeSubs.size === 0) {
			return;
		}

		for (const subId of typeSubs) {
			const subscription = this._subscriptions.get(subId);
			if (!subscription) {
				continue;
			}
			const filter = (subscription.filter ?? {}) as RpcMethods['subscribe.logs'];
			if (filter.follow !== true || !matchesLogFilter(entry, filter)) {
				continue;
			}

			const connection = this._getConnection(subscription.connectionId);
			if (connection) {
				try {
					const notification: RpcNotification = {
						method: 'logs.entry',
						params: { subscriptionId: subId, entry },
					};
					connection.notify(notification);
				} catch {
					// Connection lifecycle cleanup owns removal; never log from publication paths.
				}
			}
		}
	}

	getAgentEvents(agentId: AgentOutputRecord['agentId']): AgentOutputRecord[] {
		return this._agentEvents.recent(agentId);
	}

	getLogEntries(filter: RpcMethods['subscribe.logs']): LogEntry[] {
		return this._logs.recent(filter);
	}

	cleanup(connectionId: string): void {
		const subs = this._byConnection.get(connectionId);
		if (!subs) {
			return;
		}

		const subIds = Array.from(subs);
		for (const subId of subIds) {
			this.unsubscribe(subId);
		}

		this._logger.debug({ connectionId, count: subIds.length }, 'Cleaned up connection subscriptions');
	}

	get count(): number {
		return this._subscriptions.size;
	}
}

/**
 * Create a new subscription manager.
 *
 * @param config - Configuration for the manager
 * @returns A new SubscriptionManager instance
 */
export function createSubscriptionManager(config: SubscriptionManagerConfig): SubscriptionManager {
	return new SubscriptionManagerImpl(config);
}
