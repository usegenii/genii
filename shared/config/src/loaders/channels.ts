import path from 'node:path';
import { isPlainRecord } from '../transform/keys.js';
import type { ChannelConfig, ChannelsConfig } from '../types/channel.js';
import { readTomlTableMapOptional } from './toml.js';

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
	[key: string]: unknown;
}

/**
 * Default global channel settings
 */
const DEFAULT_SETTINGS: ChannelsConfig = {
	maxMessageLength: 4000,
	rateLimitPerMinute: 60,
};

const CHANNEL_SETTING_KEYS = {
	maxMessageLength: ['max-message-length', 'maxMessageLength'],
	rateLimitPerMinute: ['rate-limit-per-minute', 'rateLimitPerMinute'],
} as const;

function getNumberSetting(
	raw: RawChannelsToml,
	[canonicalKey, legacyKey]: readonly [string, string],
	defaultValue: number,
): number {
	const canonicalValue = raw[canonicalKey];
	if (typeof canonicalValue === 'number') {
		return canonicalValue;
	}
	const legacyValue = raw[legacyKey];
	return typeof legacyValue === 'number' ? legacyValue : defaultValue;
}

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
	const raw = await readTomlTableMapOptional<unknown>(filePath);

	if (!raw) {
		return {
			settings: { ...DEFAULT_SETTINGS },
			channels: {},
		};
	}

	// Extract global settings
	const settings: ChannelsConfig = {
		maxMessageLength: getNumberSetting(
			raw,
			CHANNEL_SETTING_KEYS.maxMessageLength,
			DEFAULT_SETTINGS.maxMessageLength,
		),
		rateLimitPerMinute: getNumberSetting(
			raw,
			CHANNEL_SETTING_KEYS.rateLimitPerMinute,
			DEFAULT_SETTINGS.rateLimitPerMinute,
		),
	};

	// Extract channel configurations (all keys that are objects)
	const channels = Object.fromEntries(
		Object.entries(raw).filter((entry): entry is [string, ChannelConfig] => isPlainRecord(entry[1])),
	);

	return { settings, channels };
}
