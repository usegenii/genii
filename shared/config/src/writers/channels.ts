/**
 * Write channels configuration.
 * @module config/writers/channels
 */

import { join } from 'node:path';
import { readTomlTableMapOptional } from '../loaders/toml.js';
import { isPlainRecord } from '../transform/keys.js';
import { writeTomlTableMap } from './toml.js';

/**
 * Channel configuration for writing.
 */
export interface ChannelConfigWrite {
	type: string;
	credential: string; // Format: "secret:channel-credential-name"
	[key: string]: unknown;
}

/**
 * Save channels configuration.
 * Merges with existing channels, optionally removing specified channels.
 *
 * @param basePath - Base config directory path
 * @param channels - Channel configs keyed by instance name
 * @param channelsToRemove - Optional array of channel names to remove
 */
export async function saveChannelsConfig(
	basePath: string,
	channels: Record<string, ChannelConfigWrite>,
	channelsToRemove?: string[],
): Promise<void> {
	const filePath = join(basePath, 'channels.toml');

	// Load existing channels if they exist
	const existing = await readTomlTableMapOptional<unknown>(filePath);

	// Start with existing data
	const merged = new Map(Object.entries(existing ?? {}));

	// Remove channels marked for deletion
	if (channelsToRemove) {
		for (const name of channelsToRemove) {
			if (isPlainRecord(merged.get(name))) {
				merged.delete(name);
			}
		}
	}

	// Merge new channels (new take precedence)
	for (const [name, config] of Object.entries(channels)) {
		const existingValue = merged.get(name);
		if (merged.has(name) && !isPlainRecord(existingValue)) {
			throw new Error(`Channel identifier "${name}" conflicts with an existing scalar setting`);
		}
		merged.set(name, config);
	}

	// This writer does not own global settings, so preserve their exact spelling and precedence.
	await writeTomlTableMap(filePath, Object.fromEntries(merged));
}
