/**
 * Write channels configuration.
 * @module config/writers/channels
 */

import { join } from 'node:path';
import { readTomlFileOptional } from '../loaders/toml.js';
import { writeTomlFile } from './toml.js';

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
	const existing = await readTomlFileOptional<Record<string, unknown>>(filePath);

	// Start with existing data
	const merged: Record<string, unknown> = { ...existing };

	// Remove channels marked for deletion
	if (channelsToRemove) {
		for (const name of channelsToRemove) {
			delete merged[name];
		}
	}

	// Merge new channels (new take precedence)
	for (const [name, config] of Object.entries(channels)) {
		merged[name] = config;
	}

	await writeTomlFile(filePath, merged);
}
