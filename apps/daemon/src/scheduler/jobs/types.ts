/**
 * Job-specific types for the scheduler.
 *
 * These types are shared across job implementations.
 */

import type { Destination } from '@genii/comms/destination/types';

/**
 * Metadata attached to pulse agent sessions.
 */
export interface PulseSessionMetadata {
	/** Indicates this is a pulse session */
	isPulse: true;
	/** Whether there's a destination for the response */
	hasResponseDestination: boolean;
	/** Optional custom path to the pulse prompt file */
	pulsePromptPath?: string;
}

/**
 * Result of a pulse job execution.
 */
export interface PulseJobResult {
	/** Whether the pulse executed successfully */
	success: boolean;
	/** The agent session ID if spawned */
	sessionId?: string;
	/** The response text from the agent */
	response?: string;
	/** Whether the response was suppressed due to rest token */
	suppressed?: boolean;
	/** Error message if failed */
	error?: string;
}

/**
 * Configuration for the pulse job.
 */
export interface PulseJobConfig {
	/** Cron schedule expression */
	schedule: string;
	/** Optional absolute path to pulse prompt file */
	promptPath?: string;
	/** Named destination, "lastActive", or undefined for silent */
	responseTo?: string;
}

/**
 * Persisted state for last active destination tracking.
 */
export interface LastActiveState {
	/** The last active destination */
	destination: Destination | null;
	/** When the destination was last updated */
	updatedAt: string;
}
