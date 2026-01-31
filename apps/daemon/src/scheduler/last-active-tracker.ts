/**
 * Last active destination tracker.
 *
 * Tracks the most recent user interaction destination for routing pulse responses
 * to "lastActive". Uses file-based persistence similar to ConversationStore.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Destination } from '@geniigotchi/comms/destination/types';
import type { Logger } from '../logging/logger';
import type { LastActiveState } from './jobs/types';

/**
 * Tracker for the most recently active destination.
 */
export interface LastActiveTracker {
	/**
	 * Update the last active destination.
	 * @param destination - The destination to set as last active
	 */
	update(destination: Destination): void;

	/**
	 * Get the last active destination.
	 * @returns The last active destination, or null if none
	 */
	get(): Destination | null;

	/**
	 * Load persisted state from disk.
	 */
	load(): Promise<void>;

	/**
	 * Save current state to disk.
	 */
	save(): Promise<void>;
}

/**
 * File-based implementation of LastActiveTracker.
 */
class FileLastActiveTracker implements LastActiveTracker {
	private readonly _filePath: string;
	private readonly _logger: Logger;
	private _destination: Destination | null = null;

	constructor(filePath: string, logger: Logger) {
		this._filePath = filePath;
		this._logger = logger.child({ component: 'LastActiveTracker', filePath });
	}

	update(destination: Destination): void {
		this._destination = destination;
		this._logger.debug(
			{ channelId: destination.channelId, ref: destination.ref },
			'Updated last active destination',
		);
	}

	get(): Destination | null {
		return this._destination;
	}

	async load(): Promise<void> {
		try {
			const content = await readFile(this._filePath, 'utf-8');
			const state = JSON.parse(content) as LastActiveState;

			if (state.destination) {
				this._destination = state.destination;
				this._logger.debug(
					{ channelId: state.destination.channelId, ref: state.destination.ref },
					'Loaded last active destination',
				);
			}
		} catch (error) {
			if (isNodeError(error) && error.code === 'ENOENT') {
				this._logger.debug('Last active state file does not exist');
				return;
			}
			this._logger.warn({ error }, 'Failed to load last active state');
		}
	}

	async save(): Promise<void> {
		if (!this._destination) {
			this._logger.debug('No last active destination to save');
			return;
		}

		const state: LastActiveState = {
			destination: this._destination,
			updatedAt: new Date().toISOString(),
		};

		const content = JSON.stringify(state, null, '\t');

		// Ensure directory exists
		const dir = dirname(this._filePath);
		await mkdir(dir, { recursive: true });

		// Write to temp file first
		const tempPath = `${this._filePath}.tmp.${Date.now()}`;

		try {
			await writeFile(tempPath, content, 'utf-8');

			// Atomic rename
			await rename(tempPath, this._filePath);

			this._logger.debug('Saved last active destination');
		} catch (error) {
			// Clean up temp file on error
			try {
				await unlink(tempPath);
			} catch {
				// Ignore cleanup errors
			}
			throw error;
		}
	}
}

/**
 * Type guard for Node.js errors with code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}

/**
 * Create a file-based last active tracker.
 *
 * @param filePath - Path to the JSON file for storing state
 * @param logger - Logger instance
 * @returns A LastActiveTracker implementation
 */
export function createLastActiveTracker(filePath: string, logger: Logger): LastActiveTracker {
	return new FileLastActiveTracker(filePath, logger);
}
