/**
 * Scheduler system types.
 *
 * Types for the scheduled job system that runs periodic tasks like pulse sessions.
 */

import type { Destination } from '@geniigotchi/comms/destination/types';
import type { PulseConfig, SchedulerConfig, SchedulerDestination } from '@geniigotchi/config/types/preferences';
import type { Cron } from 'croner';

export type { PulseConfig, SchedulerConfig, SchedulerDestination };

/**
 * Resolved destination for response routing.
 * Either a full destination object or null for silent mode.
 */
export type ResolvedDestination = Destination | null;

/**
 * Interface for a scheduled job.
 */
export interface ScheduledJob {
	/** Unique name for this job */
	readonly name: string;

	/**
	 * Execute the job.
	 * @returns Promise that resolves when the job completes
	 */
	execute(): Promise<void>;
}

/**
 * Registered job entry in the scheduler.
 */
export interface RegisteredJob {
	/** The scheduled job instance */
	job: ScheduledJob;
	/** The cron instance from croner */
	cron: Cron;
	/** Cron schedule expression */
	schedule: string;
}

/**
 * Scheduler lifecycle interface.
 */
export interface SchedulerLifecycle {
	/**
	 * Start the scheduler and all registered jobs.
	 */
	start(): Promise<void>;

	/**
	 * Stop the scheduler and all running jobs.
	 */
	stop(): Promise<void>;

	/**
	 * Check if the scheduler is running.
	 */
	readonly running: boolean;
}

/**
 * Configuration for creating a Scheduler.
 */
export interface SchedulerOptions {
	/** Logger instance */
	logger: import('../logging/logger').Logger;
}
