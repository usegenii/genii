import path from 'node:path';
import type { ChannelConfig, ChannelsConfig } from '../types/channel.js';
import { readTomlFileOptional } from './toml.js';

/**
 * Result of loading the channels configuration file
 */
export interface ChannelsLoadResult {
	settings: ChannelsConfig;
	channels: Record<string, ChannelConfig>;
}

/**
 * Raw TOML structure before separating settings from channels
 */
interface RawChannelsToml {
	maxMessageLength?: number;
	rateLimitPerMinute?: number;
	[key: string]: unknown;
}

/**
 * Default global channel settings
 */
const DEFAULT_SETTINGS: ChannelsConfig = {
	maxMessageLength: 4000,
	rateLimitPerMinute: 60,
};

/**
 * Load channels configuration from a TOML file.
 *
 * The TOML file format:
 * ```toml
 * max-message-length = 4000
 * rate-limit-per-minute = 60
 *
 * [telegram-personal]
 * type = "telegram"
 * credential = "secret:telegram-bot-token"
 * allowed-user-ids = ["123456789"]
 * polling-interval-ms = 1000
 * ```
 *
 * @param basePath - The base directory containing channels.toml
 * @returns The loaded channels configuration with global settings and individual channels
 *
 * @example
 * const { settings, channels } = await loadChannelsConfig('./config');
 * console.log(settings.maxMessageLength); // 4000
 * console.log(channels['telegram-personal']); // TelegramChannelConfig
 */
export async function loadChannelsConfig(basePath: string): Promise<ChannelsLoadResult> {
	const filePath = path.join(basePath, 'channels.toml');
	const raw = await readTomlFileOptional<RawChannelsToml>(filePath);

	if (!raw) {
		return {
			settings: { ...DEFAULT_SETTINGS },
			channels: {},
		};
	}

	// Extract global settings
	const settings: ChannelsConfig = {
		maxMessageLength: raw.maxMessageLength ?? DEFAULT_SETTINGS.maxMessageLength,
		rateLimitPerMinute: raw.rateLimitPerMinute ?? DEFAULT_SETTINGS.rateLimitPerMinute,
	};

	// Extract channel configurations (all keys that are objects)
	const channels: Record<string, ChannelConfig> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (key === 'maxMessageLength' || key === 'rateLimitPerMinute') {
			continue;
		}
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			channels[key] = value as ChannelConfig;
		}
	}

	return { settings, channels };
}
