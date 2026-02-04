/**
 * Destination resolver for pulse responses.
 *
 * Resolves the response destination from configuration, handling:
 * - Named destinations from config
 * - "lastActive" to use the most recent interaction
 * - null/undefined for silent mode
 */

import type { Destination } from '@genii/comms/destination/types';
import type { ChannelId } from '@genii/comms/types/core';
import type { SchedulerConfig, SchedulerDestination } from '@genii/config/types/preferences';
import type { Logger } from '../logging/logger';
import type { LastActiveTracker } from './last-active-tracker';

/**
 * Result of destination resolution.
 */
export interface ResolvedDestination {
	/** The destination to send responses to, or null for silent mode */
	destination: Destination | null;
	/** How the destination was resolved */
	resolution: 'named' | 'lastActive' | 'silent';
}

/**
 * Destination resolver interface.
 */
export interface DestinationResolver {
	/**
	 * Resolve the response destination based on configuration.
	 * @param responseTo - The responseTo value from pulse config
	 * @returns Resolved destination information
	 */
	resolve(responseTo: string | undefined): ResolvedDestination;
}

/**
 * Implementation of DestinationResolver.
 */
class DestinationResolverImpl implements DestinationResolver {
	private readonly _config: SchedulerConfig;
	private readonly _lastActiveTracker: LastActiveTracker;
	private readonly _logger: Logger;

	constructor(config: SchedulerConfig, lastActiveTracker: LastActiveTracker, logger: Logger) {
		this._config = config;
		this._lastActiveTracker = lastActiveTracker;
		this._logger = logger.child({ component: 'DestinationResolver' });
	}

	resolve(responseTo: string | undefined): ResolvedDestination {
		// No responseTo means silent mode
		if (!responseTo) {
			this._logger.debug('No responseTo configured, using silent mode');
			return { destination: null, resolution: 'silent' };
		}

		// Check for lastActive
		if (responseTo === 'lastActive') {
			const lastActive = this._lastActiveTracker.get();
			if (lastActive) {
				this._logger.debug(
					{ channelId: lastActive.channelId, ref: lastActive.ref },
					'Resolved lastActive destination',
				);
				return { destination: lastActive, resolution: 'lastActive' };
			}
			this._logger.debug('No lastActive destination available, using silent mode');
			return { destination: null, resolution: 'silent' };
		}

		// Look up named destination
		const namedDestination = this._config.destinations?.[responseTo];
		if (!namedDestination) {
			this._logger.warn({ responseTo }, 'Named destination not found, using silent mode');
			return { destination: null, resolution: 'silent' };
		}

		// Convert SchedulerDestination to Destination
		const destination = this._schedulerDestinationToDestination(namedDestination, responseTo);
		this._logger.debug({ responseTo, channelId: destination.channelId }, 'Resolved named destination');
		return { destination, resolution: 'named' };
	}

	/**
	 * Convert a SchedulerDestination to a full Destination.
	 */
	private _schedulerDestinationToDestination(schedulerDest: SchedulerDestination, _name: string): Destination {
		return {
			channelId: schedulerDest.channel as ChannelId,
			ref: schedulerDest.ref,
		};
	}
}

/**
 * Create a destination resolver.
 *
 * @param config - Scheduler configuration with destinations
 * @param lastActiveTracker - Tracker for last active destination
 * @param logger - Logger instance
 * @returns A DestinationResolver implementation
 */
export function createDestinationResolver(
	config: SchedulerConfig,
	lastActiveTracker: LastActiveTracker,
	logger: Logger,
): DestinationResolver {
	return new DestinationResolverImpl(config, lastActiveTracker, logger);
}
