import { type Static, Type } from '@sinclair/typebox';
import { type SecretReference, SecretReferenceSchema } from './secret.js';

/**
 * Base channel configuration schema
 */
export const BaseChannelConfigSchema = Type.Object({
	type: Type.String(),
	credential: SecretReferenceSchema,
});

/**
 * Base channel configuration interface
 */
export interface BaseChannelConfig {
	type: string;
	credential: SecretReference;
}

/**
 * Telegram channel configuration schema
 */
export const TelegramChannelConfigSchema = Type.Object({
	type: Type.Literal('telegram'),
	credential: SecretReferenceSchema,
	allowedUserIds: Type.Array(Type.String()),
	pollingIntervalMs: Type.Number(),
});

/**
 * Telegram channel configuration interface
 */
export interface TelegramChannelConfig extends BaseChannelConfig {
	type: 'telegram';
	allowedUserIds: string[];
	pollingIntervalMs: number;
}

/**
 * Union of all channel configuration types
 */
export const ChannelConfigSchema = Type.Union([TelegramChannelConfigSchema]);

/**
 * Channel configuration type - union of all channel types
 */
export type ChannelConfig = TelegramChannelConfig;

/**
 * Channels configuration schema (global channel settings)
 */
export const ChannelsConfigSchema = Type.Object({
	maxMessageLength: Type.Number(),
	rateLimitPerMinute: Type.Number(),
});

/**
 * Channels configuration interface (global channel settings)
 * Note: Individual channels are stored separately in the main config as a record
 */
export type ChannelsConfig = Static<typeof ChannelsConfigSchema>;

/**
 * Resolved channel configuration schema (with credential resolved to env var)
 */
export const ResolvedChannelConfigSchema = Type.Object({
	type: Type.String(),
	credentialEnvVar: Type.String(),
});

/**
 * Resolved channel configuration interface
 * Similar to BaseChannelConfig but with credentialEnvVar instead of credential
 */
export type ResolvedChannelConfig = Static<typeof ResolvedChannelConfigSchema>;
