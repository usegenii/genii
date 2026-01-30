import { describe, expect, it } from 'vitest';
import { createChannelId } from '../../../types/core';
import {
	buildMetadata,
	decodeRef,
	encodeRef,
	isCommand,
	mapAuthor,
	mapContent,
	mapUpdate,
	parseCommand,
} from '../mappers';
import type { TelegramCallbackQuery, TelegramChat, TelegramMessage, TelegramUpdate, TelegramUser } from '../types';

// ============================================================================
// Test Fixtures
// ============================================================================

const testChannelId = createChannelId('test-channel');

const baseUser: TelegramUser = {
	id: 123456789,
	is_bot: false,
	first_name: 'John',
	last_name: 'Doe',
	username: 'johndoe',
};

const botUser: TelegramUser = {
	id: 987654321,
	is_bot: true,
	first_name: 'TestBot',
};

const privateChat: TelegramChat = {
	id: 123456789,
	type: 'private',
};

const groupChat: TelegramChat = {
	id: -100123456789,
	type: 'group',
	title: 'Test Group',
};

const supergroupChat: TelegramChat = {
	id: -100987654321,
	type: 'supergroup',
	title: 'Test Supergroup',
	username: 'testsupergroup',
};

const forumChat: TelegramChat = {
	id: -100111222333,
	type: 'supergroup',
	title: 'Test Forum',
	is_forum: true,
};

const channelChat: TelegramChat = {
	id: -100444555666,
	type: 'channel',
	title: 'Test Channel',
	username: 'testchannel',
};

function createBaseMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
	return {
		message_id: 1,
		chat: privateChat,
		date: 1700000000,
		from: baseUser,
		...overrides,
	};
}

// ============================================================================
// encodeRef / decodeRef Tests
// ============================================================================

describe('encodeRef', () => {
	it('should encode chat_id only', () => {
		const ref = encodeRef(123456789);
		expect(ref).toBe('123456789::');
	});

	it('should encode with thread_id', () => {
		const ref = encodeRef(123456789, 42);
		expect(ref).toBe('123456789:42:');
	});

	it('should encode with message_id', () => {
		const ref = encodeRef(123456789, undefined, 100);
		expect(ref).toBe('123456789::100');
	});

	it('should encode with all three', () => {
		const ref = encodeRef(123456789, 42, 100);
		expect(ref).toBe('123456789:42:100');
	});
});

describe('decodeRef', () => {
	it('should decode chat_id only', () => {
		const result = decodeRef('123456789::');
		expect(result).toEqual({ chatId: 123456789 });
	});

	it('should decode with thread_id', () => {
		const result = decodeRef('123456789:42:');
		expect(result).toEqual({ chatId: 123456789, threadId: 42 });
	});

	it('should decode with message_id', () => {
		const result = decodeRef('123456789::100');
		expect(result).toEqual({ chatId: 123456789, messageId: 100 });
	});

	it('should decode with all three', () => {
		const result = decodeRef('123456789:42:100');
		expect(result).toEqual({ chatId: 123456789, threadId: 42, messageId: 100 });
	});

	it('should throw for invalid ref format', () => {
		expect(() => decodeRef('invalid')).toThrow('Invalid ref format');
		expect(() => decodeRef('123:456')).toThrow('Invalid ref format');
	});

	it('should throw for invalid chat ID', () => {
		expect(() => decodeRef('abc::')).toThrow('Invalid chat ID in ref');
	});
});

// ============================================================================
// buildMetadata Tests
// ============================================================================

describe('buildMetadata', () => {
	it('should map private chat type to direct', () => {
		const metadata = buildMetadata(privateChat);
		expect(metadata.conversationType).toBe('direct');
	});

	it('should map group chat type to group', () => {
		const metadata = buildMetadata(groupChat);
		expect(metadata.conversationType).toBe('group');
	});

	it('should map supergroup (non-forum) to group', () => {
		const metadata = buildMetadata(supergroupChat);
		expect(metadata.conversationType).toBe('group');
	});

	it('should map supergroup forum to topic', () => {
		const metadata = buildMetadata(forumChat);
		expect(metadata.conversationType).toBe('topic');
	});

	it('should map channel type to channel', () => {
		const metadata = buildMetadata(channelChat);
		expect(metadata.conversationType).toBe('channel');
	});

	it('should include title for groups', () => {
		const metadata = buildMetadata(groupChat);
		expect(metadata.title).toBe('Test Group');
	});

	it('should use user name as title for private chats', () => {
		const message = createBaseMessage({ chat: privateChat });
		const metadata = buildMetadata(privateChat, message);
		expect(metadata.title).toBe('John Doe');
	});

	it('should include platformData', () => {
		const metadata = buildMetadata(supergroupChat);
		expect(metadata.platformData).toEqual({
			chatId: -100987654321,
			chatType: 'supergroup',
			username: 'testsupergroup',
			isForum: undefined,
		});
	});
});

// ============================================================================
// mapAuthor Tests
// ============================================================================

describe('mapAuthor', () => {
	it('should map user to Author', () => {
		const author = mapAuthor(baseUser);
		expect(author).toEqual({
			id: '123456789',
			username: 'johndoe',
			displayName: 'John Doe',
			isBot: false,
		});
	});

	it('should handle optional fields', () => {
		const minimalUser: TelegramUser = {
			id: 111,
			is_bot: false,
			first_name: 'Jane',
		};
		const author = mapAuthor(minimalUser);
		expect(author).toEqual({
			id: '111',
			username: undefined,
			displayName: 'Jane',
			isBot: false,
		});
	});

	it('should handle bot users', () => {
		const author = mapAuthor(botUser);
		expect(author.isBot).toBe(true);
		expect(author.displayName).toBe('TestBot');
	});
});

// ============================================================================
// mapContent Tests
// ============================================================================

describe('mapContent', () => {
	it('should map text message to TextContent', () => {
		const message = createBaseMessage({ text: 'Hello, world!' });
		const content = mapContent(message);
		expect(content).toEqual({
			type: 'text',
			text: 'Hello, world!',
		});
	});

	it('should map photo to MediaContent', () => {
		const message = createBaseMessage({
			photo: [
				{ file_id: 'small', file_unique_id: 'small_u', width: 100, height: 100, file_size: 1000 },
				{ file_id: 'large', file_unique_id: 'large_u', width: 800, height: 800, file_size: 50000 },
			],
			caption: 'Photo caption',
		});
		const content = mapContent(message);
		expect(content).toEqual({
			type: 'media',
			mediaType: 'photo',
			size: 50000,
			caption: 'Photo caption',
			reference: { platform: 'telegram', id: 'large' },
		});
	});

	it('should map video to MediaContent', () => {
		const message = createBaseMessage({
			video: {
				file_id: 'video_file',
				file_unique_id: 'video_u',
				width: 1920,
				height: 1080,
				duration: 60,
				mime_type: 'video/mp4',
				file_name: 'video.mp4',
				file_size: 10000000,
			},
			caption: 'Video caption',
		});
		const content = mapContent(message);
		expect(content).toEqual({
			type: 'media',
			mediaType: 'video',
			mimeType: 'video/mp4',
			filename: 'video.mp4',
			size: 10000000,
			caption: 'Video caption',
			reference: { platform: 'telegram', id: 'video_file' },
		});
	});

	it('should map document to MediaContent', () => {
		const message = createBaseMessage({
			document: {
				file_id: 'doc_file',
				file_unique_id: 'doc_u',
				file_name: 'document.pdf',
				mime_type: 'application/pdf',
				file_size: 500000,
			},
		});
		const content = mapContent(message);
		expect(content).toEqual({
			type: 'media',
			mediaType: 'document',
			mimeType: 'application/pdf',
			filename: 'document.pdf',
			size: 500000,
			caption: undefined,
			reference: { platform: 'telegram', id: 'doc_file' },
		});
	});

	it('should map location to LocationContent', () => {
		const message = createBaseMessage({
			location: { latitude: 40.7128, longitude: -74.006 },
		});
		const content = mapContent(message);
		expect(content).toEqual({
			type: 'location',
			latitude: 40.7128,
			longitude: -74.006,
		});
	});

	it('should map contact to ContactContent', () => {
		const message = createBaseMessage({
			contact: {
				phone_number: '+1234567890',
				first_name: 'Contact',
				last_name: 'Person',
			},
		});
		const content = mapContent(message);
		expect(content).toEqual({
			type: 'contact',
			phoneNumber: '+1234567890',
			firstName: 'Contact',
			lastName: 'Person',
		});
	});

	it('should map sticker to StickerContent', () => {
		const message = createBaseMessage({
			sticker: {
				file_id: 'sticker_file',
				file_unique_id: 'sticker_u',
				type: 'regular',
				width: 512,
				height: 512,
				is_animated: false,
				is_video: false,
				emoji: '😀',
			},
		});
		const content = mapContent(message);
		expect(content).toEqual({
			type: 'sticker',
			emoji: '😀',
			reference: { platform: 'telegram', id: 'sticker_file' },
		});
	});

	it('should return empty text for message with no content', () => {
		const message = createBaseMessage({});
		const content = mapContent(message);
		expect(content).toEqual({
			type: 'text',
			text: '',
		});
	});
});

// ============================================================================
// isCommand / parseCommand Tests
// ============================================================================

describe('isCommand', () => {
	it('should detect /command', () => {
		const message = createBaseMessage({ text: '/start' });
		expect(isCommand(message)).toBe(true);
	});

	it('should return false for non-command', () => {
		const message = createBaseMessage({ text: 'Hello, world!' });
		expect(isCommand(message)).toBe(false);
	});

	it('should return false for empty message', () => {
		const message = createBaseMessage({});
		expect(isCommand(message)).toBe(false);
	});
});

describe('parseCommand', () => {
	it('should parse command and args', () => {
		const message = createBaseMessage({ text: '/echo Hello, world!' });
		const result = parseCommand(message);
		expect(result).toEqual({ command: 'echo', args: 'Hello, world!' });
	});

	it('should parse command without args', () => {
		const message = createBaseMessage({ text: '/start' });
		const result = parseCommand(message);
		expect(result).toEqual({ command: 'start', args: '' });
	});

	it('should handle command with @bot suffix', () => {
		const message = createBaseMessage({ text: '/help@mybot' });
		const result = parseCommand(message);
		expect(result).toEqual({ command: 'help', args: '' });
	});

	it('should handle command with @bot suffix and args', () => {
		const message = createBaseMessage({ text: '/settings@mybot dark mode' });
		const result = parseCommand(message);
		expect(result).toEqual({ command: 'settings', args: 'dark mode' });
	});

	it('should return null for non-command', () => {
		const message = createBaseMessage({ text: 'Hello, world!' });
		const result = parseCommand(message);
		expect(result).toBeNull();
	});

	it('should return null for empty message', () => {
		const message = createBaseMessage({});
		const result = parseCommand(message);
		expect(result).toBeNull();
	});
});

// ============================================================================
// mapUpdate Tests
// ============================================================================

describe('mapUpdate', () => {
	it('should map message to MessageReceivedEvent', () => {
		const update: TelegramUpdate = {
			update_id: 1,
			message: createBaseMessage({ text: 'Hello!' }),
		};
		const event = mapUpdate(update, testChannelId);
		expect(event).not.toBeNull();
		expect(event?.type).toBe('message_received');
		if (event?.type === 'message_received') {
			expect(event.content).toEqual({ type: 'text', text: 'Hello!' });
			expect(event.author.id).toBe('123456789');
		}
	});

	it('should map command to CommandReceivedEvent', () => {
		const update: TelegramUpdate = {
			update_id: 2,
			message: createBaseMessage({ text: '/start welcome' }),
		};
		const event = mapUpdate(update, testChannelId);
		expect(event).not.toBeNull();
		expect(event?.type).toBe('command_received');
		if (event?.type === 'command_received') {
			expect(event.command).toBe('start');
			expect(event.args).toBe('welcome');
		}
	});

	it('should map edited_message to MessageEditedEvent', () => {
		const update: TelegramUpdate = {
			update_id: 3,
			edited_message: createBaseMessage({ text: 'Updated text' }),
		};
		const event = mapUpdate(update, testChannelId);
		expect(event).not.toBeNull();
		expect(event?.type).toBe('message_edited');
		if (event?.type === 'message_edited') {
			expect(event.newContent).toEqual({ type: 'text', text: 'Updated text' });
		}
	});

	it('should map callback_query to CallbackReceivedEvent', () => {
		const callbackQuery: TelegramCallbackQuery = {
			id: 'callback_123',
			from: baseUser,
			message: createBaseMessage({}),
			chat_instance: 'chat_instance_123',
			data: 'button_clicked',
		};
		const update: TelegramUpdate = {
			update_id: 4,
			callback_query: callbackQuery,
		};
		const event = mapUpdate(update, testChannelId);
		expect(event).not.toBeNull();
		expect(event?.type).toBe('callback_received');
		if (event?.type === 'callback_received') {
			expect(event.callbackId).toBe('callback_123');
			expect(event.data).toBe('button_clicked');
		}
	});

	it('should return null for callback_query without message', () => {
		const callbackQuery: TelegramCallbackQuery = {
			id: 'callback_123',
			from: baseUser,
			chat_instance: 'chat_instance_123',
			data: 'button_clicked',
		};
		const update: TelegramUpdate = {
			update_id: 5,
			callback_query: callbackQuery,
		};
		const event = mapUpdate(update, testChannelId);
		expect(event).toBeNull();
	});

	it('should return null for unhandled update types', () => {
		const update: TelegramUpdate = {
			update_id: 6,
		};
		const event = mapUpdate(update, testChannelId);
		expect(event).toBeNull();
	});

	it('should include correct timestamp from message', () => {
		const update: TelegramUpdate = {
			update_id: 7,
			message: createBaseMessage({ date: 1700000000 }),
		};
		const event = mapUpdate(update, testChannelId);
		expect(event).not.toBeNull();
		if (event?.type === 'message_received') {
			expect(event.timestamp).toBe(1700000000000); // Converted to milliseconds
		}
	});

	it('should handle message without from field', () => {
		const messageWithoutFrom: TelegramMessage = {
			message_id: 1,
			chat: privateChat,
			date: 1700000000,
			text: 'Anonymous message',
		};
		const update: TelegramUpdate = {
			update_id: 8,
			message: messageWithoutFrom,
		};
		const event = mapUpdate(update, testChannelId);
		expect(event).not.toBeNull();
		if (event?.type === 'message_received') {
			expect(event.author).toEqual({ id: 'unknown', isBot: false });
		}
	});
});
