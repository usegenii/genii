/**
 * Core scheduler component.
 *
 * Manages scheduled jobs using the croner library for cron-based scheduling.
 * Provides lifecycle management (start/stop) and job registration.
 */

import { Cron } from 'croner';
import type { Logger } from '../logging/logger';
import type { RegisteredJob, ScheduledJob, SchedulerLifecycle, SchedulerOptions } from './types';

/**
 * Scheduler implementation using croner.
 */
export class Scheduler implements SchedulerLifecycle {
	private readonly _logger: Logger;
	private readonly _jobs: Map<string, RegisteredJob> = new Map();
	private _running = false;

	constructor(options: SchedulerOptions) {
		this._logger = options.logger.child({ component: 'Scheduler' });
	}

	/**
	 * Register a job with a cron schedule.
	 * The job will be started when the scheduler starts.
	 *
	 * @param job - The job to register
	 * @param schedule - Cron expression for when to run the job
	 */
	register(job: ScheduledJob, schedule: string): void {
		if (this._jobs.has(job.name)) {
			throw new Error(`Job with name "${job.name}" is already registered`);
		}

		// Create the cron job (paused initially)
		const cron = new Cron(schedule, { paused: true }, async () => {
			await this._executeJob(job);
		});

		this._jobs.set(job.name, {
			job,
			cron,
			schedule,
		});

		this._logger.debug({ jobName: job.name, schedule }, 'Registered job');

		// If scheduler is already running, start the job immediately
		if (this._running) {
			cron.resume();
			this._logger.debug({ jobName: job.name }, 'Started job (scheduler already running)');
		}
	}

	/**
	 * Unregister a job by name.
	 *
	 * @param name - Name of the job to unregister
	 */
	unregister(name: string): void {
		const registered = this._jobs.get(name);
		if (!registered) {
			return;
		}

		registered.cron.stop();
		this._jobs.delete(name);
		this._logger.debug({ jobName: name }, 'Unregistered job');
	}

	/**
	 * Start the scheduler and all registered jobs.
	 */
	async start(): Promise<void> {
		if (this._running) {
			this._logger.warn('Scheduler is already running');
			return;
		}

		this._logger.info({ jobCount: this._jobs.size }, 'Starting scheduler');

		// Resume all cron jobs
		for (const [name, registered] of this._jobs) {
			registered.cron.resume();
			this._logger.debug({ jobName: name, schedule: registered.schedule }, 'Started job');
		}

		this._running = true;
		this._logger.info('Scheduler started');
	}

	/**
	 * Stop the scheduler and all running jobs.
	 */
	async stop(): Promise<void> {
		if (!this._running) {
			this._logger.warn('Scheduler is not running');
			return;
		}

		this._logger.info('Stopping scheduler');

		// Stop all cron jobs
		for (const [name, registered] of this._jobs) {
			registered.cron.stop();
			this._logger.debug({ jobName: name }, 'Stopped job');
		}

		this._running = false;
		this._logger.info('Scheduler stopped');
	}

	/**
	 * Check if the scheduler is running.
	 */
	get running(): boolean {
		return this._running;
	}

	/**
	 * Get the list of registered job names.
	 */
	get jobNames(): string[] {
		return [...this._jobs.keys()];
	}

	/**
	 * Get the next run time for a job.
	 *
	 * @param name - Name of the job
	 * @returns The next scheduled run time, or null if not found
	 */
	getNextRun(name: string): Date | null {
		const registered = this._jobs.get(name);
		if (!registered) {
			return null;
		}
		return registered.cron.nextRun();
	}

	/**
	 * Execute a job with error handling.
	 */
	private async _executeJob(job: ScheduledJob): Promise<void> {
		this._logger.info({ jobName: job.name }, 'Executing scheduled job');

		try {
			await job.execute();
			this._logger.info({ jobName: job.name }, 'Job completed successfully');
		} catch (error) {
			this._logger.error({ error, jobName: job.name }, 'Job execution failed');
		}
	}
}

/**
 * Create a scheduler instance.
 *
 * @param options - Scheduler configuration
 * @returns A new Scheduler instance
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
	return new Scheduler(options);
}
