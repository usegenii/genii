/**
 * Telegram mappers - convert between Telegram API types and canonical comms types.
 */

import type {
	Author,
	ContactContent,
	InboundContent,
	LocationContent,
	MediaContent,
	MediaReference,
	StickerContent,
	TextContent,
} from '../../content/types';
import type { ConversationMetadata, DestinationWithMetadata } from '../../destination/types';
import type {
	CallbackReceivedEvent,
	CommandReceivedEvent,
	ConversationStartedEvent,
	InboundEvent,
	MessageEditedEvent,
	MessageReceivedEvent,
} from '../../events/types';
import type { ChannelId } from '../../types/core';
import type {
	TelegramCallbackQuery,
	TelegramChat,
	TelegramChatMemberUpdated,
	TelegramMessage,
	TelegramUpdate,
	TelegramUser,
} from './types';

// ============================================================================
// Ref Encoding/Decoding
// ============================================================================

/**
 * Encode platform IDs into opaque ref string.
 * Format: {chat_id}:{thread_id}:{message_id}
 */
export function encodeRef(chatId: number, threadId?: number, messageId?: number): string {
	const threadPart = threadId !== undefined ? String(threadId) : '';
	const messagePart = messageId !== undefined ? String(messageId) : '';
	return `${chatId}:${threadPart}:${messagePart}`;
}

/**
 * Decode ref back to platform IDs.
 */
export function decodeRef(ref: string): { chatId: number; threadId?: number; messageId?: number } {
	const parts = ref.split(':');
	if (parts.length !== 3) {
		throw new Error(`Invalid ref format: ${ref}`);
	}

	const [chatIdStr, threadIdStr, messageIdStr] = parts as [string, string, string];

	const chatId = Number.parseInt(chatIdStr, 10);
	if (Number.isNaN(chatId)) {
		throw new Error(`Invalid chat ID in ref: ${ref}`);
	}

	const result: { chatId: number; threadId?: number; messageId?: number } = { chatId };

	if (threadIdStr !== '') {
		const threadId = Number.parseInt(threadIdStr, 10);
		if (!Number.isNaN(threadId)) {
			result.threadId = threadId;
		}
	}

	if (messageIdStr !== '') {
		const messageId = Number.parseInt(messageIdStr, 10);
		if (!Number.isNaN(messageId)) {
			result.messageId = messageId;
		}
	}

	return result;
}

// ============================================================================
// Metadata Builders
// ============================================================================

/**
 * Extract ConversationMetadata from Telegram chat object.
 */
export function buildMetadata(chat: TelegramChat, message?: TelegramMessage): ConversationMetadata {
	// Determine title
	let title: string | undefined;
	if (chat.type === 'private') {
		// For private chats, use the user's name from the message if available
		if (message?.from) {
			title = message.from.last_name
				? `${message.from.first_name} ${message.from.last_name}`
				: message.from.first_name;
		}
	} else {
		title = chat.title;
	}

	// Map conversation type
	let conversationType: ConversationMetadata['conversationType'];
	switch (chat.type) {
		case 'private':
			conversationType = 'direct';
			break;
		case 'group':
			conversationType = 'group';
			break;
		case 'supergroup':
			conversationType = chat.is_forum ? 'topic' : 'group';
			break;
		case 'channel':
			conversationType = 'channel';
			break;
		default:
			conversationType = 'group';
	}

	return {
		title,
		conversationType,
		participantCount: undefined, // Not available in message context
		platformData: {
			chatId: chat.id,
			chatType: chat.type,
			username: chat.username,
			isForum: chat.is_forum,
		},
	};
}

/**
 * Create a "conversation ref" for routing - includes chat_id and thread_id only.
 * Message ID is NOT included so all messages in the same chat/thread share the same destination.
 */
export function encodeConversationRef(chatId: number, threadId?: number): string {
	const threadPart = threadId !== undefined ? String(threadId) : '';
	return `${chatId}:${threadPart}:`;
}

/**
 * Create a Destination with encoded ref and extracted metadata from the chat.
 * The ref uses conversation-level routing (excludes message_id).
 * Message ID is stored in metadata.platformData for reply purposes.
 */
export function buildDestination(message: TelegramMessage, channelId: ChannelId): DestinationWithMetadata {
	// Use conversation ref (without message_id) for routing
	const ref = encodeConversationRef(message.chat.id, message.message_thread_id);
	const metadata = buildMetadata(message.chat, message);

	// Store message_id in platformData for reply purposes
	if (metadata.platformData) {
		metadata.platformData.replyToMessageId = message.message_id;
	}

	return {
		channelId,
		ref,
		metadata,
	};
}

// ============================================================================
// Author Mapping
// ============================================================================

/**
 * Map TelegramUser to Author.
 */
export function mapAuthor(user: TelegramUser): Author {
	const displayName = user.last_name ? `${user.first_name} ${user.last_name}` : user.first_name;

	return {
		id: String(user.id),
		username: user.username,
		displayName,
		isBot: user.is_bot,
	};
}

// ============================================================================
// Content Mapping
// ============================================================================

/**
 * Create a MediaReference for Telegram.
 */
function createMediaReference(fileId: string): MediaReference {
	return {
		platform: 'telegram',
		id: fileId,
	};
}

/**
 * Map message content to InboundContent.
 */
export function mapContent(message: TelegramMessage): InboundContent {
	// Check for media types in order of specificity

	// Photo - use the largest size
	if (message.photo && message.photo.length > 0) {
		const largestPhoto = message.photo.reduce((prev, curr) =>
			(curr.file_size ?? 0) > (prev.file_size ?? 0) ? curr : prev,
		);
		const content: MediaContent = {
			type: 'media',
			mediaType: 'photo',
			size: largestPhoto.file_size,
			caption: message.caption,
			reference: createMediaReference(largestPhoto.file_id),
		};
		return content;
	}

	// Video
	if (message.video) {
		const content: MediaContent = {
			type: 'media',
			mediaType: 'video',
			mimeType: message.video.mime_type,
			filename: message.video.file_name,
			size: message.video.file_size,
			caption: message.caption,
			reference: createMediaReference(message.video.file_id),
		};
		return content;
	}

	// Audio
	if (message.audio) {
		const content: MediaContent = {
			type: 'media',
			mediaType: 'audio',
			mimeType: message.audio.mime_type,
			filename: message.audio.file_name,
			size: message.audio.file_size,
			caption: message.caption,
			reference: createMediaReference(message.audio.file_id),
		};
		return content;
	}

	// Voice
	if (message.voice) {
		const content: MediaContent = {
			type: 'media',
			mediaType: 'voice',
			mimeType: message.voice.mime_type,
			size: message.voice.file_size,
			caption: message.caption,
			reference: createMediaReference(message.voice.file_id),
		};
		return content;
	}

	// Document
	if (message.document) {
		const content: MediaContent = {
			type: 'media',
			mediaType: 'document',
			mimeType: message.document.mime_type,
			filename: message.document.file_name,
			size: message.document.file_size,
			caption: message.caption,
			reference: createMediaReference(message.document.file_id),
		};
		return content;
	}

	// Animation (GIF)
	if (message.animation) {
		const content: MediaContent = {
			type: 'media',
			mediaType: 'animation',
			mimeType: message.animation.mime_type,
			filename: message.animation.file_name,
			size: message.animation.file_size,
			caption: message.caption,
			reference: createMediaReference(message.animation.file_id),
		};
		return content;
	}

	// Sticker
	if (message.sticker) {
		const content: StickerContent = {
			type: 'sticker',
			emoji: message.sticker.emoji,
			reference: createMediaReference(message.sticker.file_id),
		};
		return content;
	}

	// Location
	if (message.location) {
		const content: LocationContent = {
			type: 'location',
			latitude: message.location.latitude,
			longitude: message.location.longitude,
		};
		return content;
	}

	// Contact
	if (message.contact) {
		const content: ContactContent = {
			type: 'contact',
			phoneNumber: message.contact.phone_number,
			firstName: message.contact.first_name,
			lastName: message.contact.last_name,
		};
		return content;
	}

	// Default to text (may be empty or have caption)
	const content: TextContent = {
		type: 'text',
		text: message.text ?? message.caption ?? '',
	};
	return content;
}

// ============================================================================
// Command Parsing
// ============================================================================

/**
 * Check if message starts with a bot command (text starting with /).
 */
export function isCommand(message: TelegramMessage): boolean {
	const text = message.text ?? '';
	return text.startsWith('/');
}

/**
 * Parse a bot command from message text.
 * Command is without the /, args is everything after.
 */
export function parseCommand(message: TelegramMessage): { command: string; args: string } | null {
	const text = message.text ?? '';
	if (!text.startsWith('/')) {
		return null;
	}

	// Remove the leading /
	const withoutSlash = text.slice(1);

	// Split on first space
	const spaceIndex = withoutSlash.indexOf(' ');
	if (spaceIndex === -1) {
		// No space means no args, also handle @bot suffix
		const atIndex = withoutSlash.indexOf('@');
		const command = atIndex === -1 ? withoutSlash : withoutSlash.slice(0, atIndex);
		return { command, args: '' };
	}

	// Extract command (before space) and args (after space)
	let command = withoutSlash.slice(0, spaceIndex);
	const args = withoutSlash.slice(spaceIndex + 1).trim();

	// Handle @bot suffix in command
	const atIndex = command.indexOf('@');
	if (atIndex !== -1) {
		command = command.slice(0, atIndex);
	}

	return { command, args };
}

// ============================================================================
// Event Mapping
// ============================================================================

/**
 * Map a Telegram message to MessageReceivedEvent.
 */
export function mapMessage(message: TelegramMessage, channelId: ChannelId): MessageReceivedEvent {
	const origin = buildDestination(message, channelId);
	const author = message.from ? mapAuthor(message.from) : { id: 'unknown', isBot: false };
	const content = mapContent(message);

	return {
		type: 'message_received',
		origin,
		author,
		content,
		timestamp: message.date * 1000, // Convert Unix seconds to milliseconds
	};
}

/**
 * Map a Telegram message to CommandReceivedEvent.
 */
function mapCommandMessage(message: TelegramMessage, channelId: ChannelId): CommandReceivedEvent | null {
	const parsed = parseCommand(message);
	if (!parsed) {
		return null;
	}

	const origin = buildDestination(message, channelId);
	const author = message.from ? mapAuthor(message.from) : { id: 'unknown', isBot: false };

	return {
		type: 'command_received',
		origin,
		author,
		command: parsed.command,
		args: parsed.args,
		timestamp: message.date * 1000,
	};
}

/**
 * Map a Telegram message to MessageEditedEvent.
 */
function mapEditedMessage(message: TelegramMessage, channelId: ChannelId): MessageEditedEvent {
	const origin = buildDestination(message, channelId);
	const author = message.from ? mapAuthor(message.from) : { id: 'unknown', isBot: false };
	const newContent = mapContent(message);

	return {
		type: 'message_edited',
		origin,
		author,
		newContent,
		timestamp: message.date * 1000,
	};
}

/**
 * Map callback query to CallbackReceivedEvent.
 */
export function mapCallbackQuery(query: TelegramCallbackQuery, channelId: ChannelId): CallbackReceivedEvent | null {
	// Need a message to get the origin
	if (!query.message) {
		return null;
	}

	const origin = buildDestination(query.message, channelId);
	const author = mapAuthor(query.from);

	return {
		type: 'callback_received',
		origin,
		author,
		callbackId: query.id,
		data: query.data ?? '',
		timestamp: Date.now(),
	};
}

/**
 * Map chat member update to ConversationStartedEvent when bot is added.
 */
function mapChatMemberUpdate(update: TelegramChatMemberUpdated, channelId: ChannelId): ConversationStartedEvent | null {
	// Check if the bot was added to the chat (status changed from non-member to member)
	const oldStatus = update.old_chat_member.status;
	const newStatus = update.new_chat_member.status;

	// Bot is being added if transitioning from left/kicked to member/admin/etc
	const wasNotMember = oldStatus === 'left' || oldStatus === 'kicked';
	const isNowMember = newStatus === 'member' || newStatus === 'administrator' || newStatus === 'creator';

	if (!(wasNotMember && isNowMember)) {
		return null;
	}

	const metadata = buildMetadata(update.chat);
	const author = mapAuthor(update.from);

	return {
		type: 'conversation_started',
		origin: {
			channelId,
			ref: encodeRef(update.chat.id),
			metadata,
		},
		author,
		timestamp: update.date * 1000,
	};
}

/**
 * Main entry point - map a TelegramUpdate to an InboundEvent.
 */
export function mapUpdate(update: TelegramUpdate, channelId: ChannelId): InboundEvent | null {
	// Handle regular messages
	if (update.message) {
		// Check if it's a bot command
		if (isCommand(update.message)) {
			return mapCommandMessage(update.message, channelId);
		}
		return mapMessage(update.message, channelId);
	}

	// Handle edited messages
	if (update.edited_message) {
		return mapEditedMessage(update.edited_message, channelId);
	}

	// Handle callback queries
	if (update.callback_query) {
		return mapCallbackQuery(update.callback_query, channelId);
	}

	// Handle chat member updates (bot added to chat)
	if (update.my_chat_member) {
		return mapChatMemberUpdate(update.my_chat_member, channelId);
	}

	// Unknown update type
	return null;
}
