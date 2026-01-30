/**
 * Telegram-specific types for the comms package.
 */

import type { ChannelConfig } from '../../channel/types';

/**
 * Configuration for creating a Telegram channel.
 */
export interface TelegramConfig extends ChannelConfig {
	/** Bot token from BotFather */
	token: string;
	/** Timeout for long polling in seconds (default: 30) */
	pollingTimeout?: number;
	/** Types of updates to receive */
	allowedUpdates?: string[];
	/** Custom API endpoint (default: https://api.telegram.org) */
	baseUrl?: string;
}

// ============================================================================
// Telegram API Types
// ============================================================================

/**
 * Represents an incoming update from Telegram.
 */
export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
	my_chat_member?: TelegramChatMemberUpdated;
}

/**
 * Represents a Telegram message.
 */
export interface TelegramMessage {
	message_id: number;
	message_thread_id?: number;
	from?: TelegramUser;
	chat: TelegramChat;
	date: number;
	text?: string;
	caption?: string;
	photo?: TelegramPhotoSize[];
	video?: TelegramVideo;
	audio?: TelegramAudio;
	voice?: TelegramVoice;
	document?: TelegramDocument;
	animation?: TelegramAnimation;
	sticker?: TelegramSticker;
	location?: TelegramLocation;
	contact?: TelegramContact;
	reply_to_message?: TelegramMessage;
	entities?: TelegramMessageEntity[];
	caption_entities?: TelegramMessageEntity[];
	new_chat_members?: TelegramUser[];
	left_chat_member?: TelegramUser;
}

/**
 * Represents a Telegram user or bot.
 */
export interface TelegramUser {
	id: number;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
}

/**
 * Represents a Telegram chat.
 */
export interface TelegramChat {
	id: number;
	type: 'private' | 'group' | 'supergroup' | 'channel';
	title?: string;
	username?: string;
	is_forum?: boolean;
}

/**
 * Represents a callback query from an inline keyboard button.
 */
export interface TelegramCallbackQuery {
	id: string;
	from: TelegramUser;
	message?: TelegramMessage;
	chat_instance: string;
	data?: string;
}

/**
 * Represents a change in chat member status.
 */
export interface TelegramChatMemberUpdated {
	chat: TelegramChat;
	from: TelegramUser;
	date: number;
	old_chat_member: TelegramChatMember;
	new_chat_member: TelegramChatMember;
}

/**
 * Represents a chat member with their status.
 */
export interface TelegramChatMember {
	status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
	user: TelegramUser;
}

// ============================================================================
// Media Types
// ============================================================================

/**
 * Represents a photo size.
 */
export interface TelegramPhotoSize {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	file_size?: number;
}

/**
 * Represents a video file.
 */
export interface TelegramVideo {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	duration: number;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

/**
 * Represents an audio file.
 */
export interface TelegramAudio {
	file_id: string;
	file_unique_id: string;
	duration: number;
	performer?: string;
	title?: string;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

/**
 * Represents a voice message.
 */
export interface TelegramVoice {
	file_id: string;
	file_unique_id: string;
	duration: number;
	mime_type?: string;
	file_size?: number;
}

/**
 * Represents a general file.
 */
export interface TelegramDocument {
	file_id: string;
	file_unique_id: string;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

/**
 * Represents an animation (GIF or video without sound).
 */
export interface TelegramAnimation {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	duration: number;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

/**
 * Represents a sticker.
 */
export interface TelegramSticker {
	file_id: string;
	file_unique_id: string;
	type: 'regular' | 'mask' | 'custom_emoji';
	width: number;
	height: number;
	is_animated: boolean;
	is_video: boolean;
	emoji?: string;
}

/**
 * Represents a location.
 */
export interface TelegramLocation {
	latitude: number;
	longitude: number;
}

/**
 * Represents a contact.
 */
export interface TelegramContact {
	phone_number: string;
	first_name: string;
	last_name?: string;
	user_id?: number;
}

/**
 * Represents a special entity in a text message.
 */
export interface TelegramMessageEntity {
	type: string;
	offset: number;
	length: number;
	url?: string;
	user?: TelegramUser;
	language?: string;
	custom_emoji_id?: string;
}

// ============================================================================
// File API Types
// ============================================================================

/**
 * Represents a file ready to be downloaded.
 */
export interface TelegramFile {
	file_id: string;
	file_unique_id: string;
	file_size?: number;
	file_path?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Generic wrapper for Telegram API responses.
 */
export interface TelegramApiResponse<T> {
	ok: boolean;
	result?: T;
	error_code?: number;
	description?: string;
}
