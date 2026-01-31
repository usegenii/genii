/**
 * Telegram channel implementation.
 */

import type { Channel } from '../../channel/types';
import type { CompoundContent, MediaOutbound, OutboundContent, TextContent } from '../../content/types';
import { TypedEventEmitter } from '../../events/emitter';
import type {
	ChannelConnectedEvent,
	ChannelDisconnectedEvent,
	ChannelErrorEvent,
	ChannelLifecycleEvent,
	InboundEvent,
	IntentProcessedConfirmation,
	OutboundIntent,
} from '../../events/types';
import type { InboundFilter } from '../../filters/types';
import { type Logger, noopLogger } from '../../logging/types';
import type { ChannelId, ChannelStatus, Disposable } from '../../types/core';
import { generateChannelId } from '../../types/core';
import { decodeRef, mapUpdate } from './mappers';
import { TelegramTransport } from './transport';
import type { TelegramConfig, TelegramFile, TelegramUpdate } from './types';

/**
 * Extract the reply-to message ID from destination metadata.
 * This is Telegram-specific - message ID is stored in platformData for replies.
 */
function getReplyToMessageId(destination: {
	metadata?: { platformData?: { replyToMessageId?: number } };
}): number | undefined {
	return destination.metadata?.platformData?.replyToMessageId;
}

/**
 * Parameters for sending a message via Telegram API.
 */
interface SendMessageParams {
	chat_id: number;
	text: string;
	message_thread_id?: number;
	reply_to_message_id?: number;
	parse_mode?: 'MarkdownV2' | 'HTML';
}

/**
 * Default filter that allows all updates.
 */
const ALLOW_ALL_FILTER: InboundFilter<TelegramUpdate> = {
	shouldProcess: () => true,
};

/**
 * TelegramChannel implements the Channel interface for Telegram.
 */
export class TelegramChannel implements Channel {
	readonly id: ChannelId;
	readonly adapter: string = 'telegram';

	private _status: ChannelStatus = 'disconnected';
	private readonly _transport: TelegramTransport;
	private readonly _inboundEmitter: TypedEventEmitter<InboundEvent>;
	private readonly _lifecycleEmitter: TypedEventEmitter<ChannelLifecycleEvent>;
	private readonly _config: TelegramConfig;
	private readonly _filter: InboundFilter<TelegramUpdate>;
	private readonly _logger: Logger;
	private readonly _lastTypingAction = new Map<number, number>();
	private static readonly TYPING_DEBOUNCE_MS = 4000;

	constructor(config: TelegramConfig, id?: ChannelId, filter?: InboundFilter<TelegramUpdate>, logger?: Logger) {
		this.id = id ?? generateChannelId();
		this._config = config;
		this._transport = new TelegramTransport(config);
		this._inboundEmitter = new TypedEventEmitter<InboundEvent>();
		this._lifecycleEmitter = new TypedEventEmitter<ChannelLifecycleEvent>();
		this._filter = filter ?? ALLOW_ALL_FILTER;
		this._logger = logger?.child({ component: 'TelegramChannel', channelId: this.id }) ?? noopLogger;
	}

	/**
	 * Current connection status.
	 */
	get status(): ChannelStatus {
		return this._status;
	}

	/**
	 * Process a semantic intent based on Telegram capabilities.
	 */
	async process(intent: OutboundIntent): Promise<IntentProcessedConfirmation> {
		const timestamp = Date.now();
		this._logger.debug({ intentType: intent.type }, 'Processing outbound intent');

		try {
			switch (intent.type) {
				case 'agent_thinking': {
					const { chatId } = decodeRef(intent.destination.ref);
					await this.sendTypingIndicator(chatId);
					return { intentType: intent.type, success: true, timestamp };
				}

				case 'agent_streaming': {
					// Refresh typing indicator (Telegram typing expires after 5s)
					const { chatId } = decodeRef(intent.destination.ref);
					await this.sendTypingIndicator(chatId);
					return { intentType: intent.type, success: true, timestamp };
				}

				case 'agent_responding': {
					const { chatId, threadId } = decodeRef(intent.destination.ref);
					const replyToMessageId = getReplyToMessageId(intent.destination);

					// Check if this is media content
					if (intent.content.type === 'media') {
						this._logger.debug({ chatId, mediaType: intent.content.mediaType }, 'Sending media message');
						await this.sendMedia(chatId, intent.content, threadId, replyToMessageId);
						this._logger.info({ chatId }, 'Sent media message');
						return { intentType: intent.type, success: true, timestamp };
					}

					// Handle text and compound content
					const { text, parseMode } = this.getTextFromContent(intent.content);

					const params: SendMessageParams = {
						chat_id: chatId,
						text,
					};

					if (threadId !== undefined) {
						params.message_thread_id = threadId;
					}

					if (replyToMessageId !== undefined) {
						params.reply_to_message_id = replyToMessageId;
					}

					if (parseMode) {
						params.parse_mode = parseMode;
					}

					this._logger.debug({ chatId, textLength: text.length }, 'Sending text message');
					await this.sendMessage(params);
					this._logger.info({ chatId }, 'Sent text message');
					return { intentType: intent.type, success: true, timestamp };
				}

				case 'agent_tool_call': {
					// Just send typing indicator
					const { chatId } = decodeRef(intent.destination.ref);
					await this.sendTypingIndicator(chatId);
					return { intentType: intent.type, success: true, timestamp };
				}

				case 'agent_error': {
					const { chatId, threadId } = decodeRef(intent.destination.ref);
					const replyToMessageId = getReplyToMessageId(intent.destination);

					// Format error message with warning emoji
					const errorText = `\u26A0\uFE0F Error: ${intent.error}`;

					const params: SendMessageParams = {
						chat_id: chatId,
						text: errorText,
					};

					if (threadId !== undefined) {
						params.message_thread_id = threadId;
					}

					if (replyToMessageId !== undefined) {
						params.reply_to_message_id = replyToMessageId;
					}

					this._logger.warn({ chatId, error: intent.error }, 'Sending error message');
					await this.sendMessage(params);
					return { intentType: intent.type, success: true, timestamp };
				}

				default: {
					// Exhaustive check
					const _exhaustive: never = intent;
					return {
						intentType: (_exhaustive as OutboundIntent).type,
						success: false,
						error: 'Unknown intent type',
						timestamp,
					};
				}
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			this._logger.error({ error: errorMsg, intentType: intent.type }, 'Failed to process intent');
			return {
				intentType: intent.type,
				success: false,
				error: errorMsg,
				timestamp,
			};
		}
	}

	/**
	 * Fetch media by file_id reference.
	 */
	async fetchMedia(ref: string): Promise<ReadableStream<Uint8Array>> {
		// Call getFile API to get file path
		const file = await this._transport.callApi<TelegramFile>('getFile', { file_id: ref });

		if (!file.file_path) {
			throw new Error('File path not available');
		}

		// Construct download URL
		const baseUrl = this._config.baseUrl ?? 'https://api.telegram.org';
		const downloadUrl = `${baseUrl}/file/bot${this._config.token}/${file.file_path}`;

		// Fetch the file
		const response = await fetch(downloadUrl);

		if (!response.ok) {
			throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
		}

		if (!response.body) {
			throw new Error('Response body is null');
		}

		return response.body;
	}

	/**
	 * Subscribe to inbound events.
	 */
	subscribe(handler: (event: InboundEvent) => void): Disposable {
		return this._inboundEmitter.on(handler);
	}

	/**
	 * Async iterator for inbound events.
	 */
	events(): AsyncIterable<InboundEvent> {
		return this._inboundEmitter;
	}

	/**
	 * Subscribe to lifecycle events.
	 */
	onLifecycle(handler: (event: ChannelLifecycleEvent) => void): Disposable {
		return this._lifecycleEmitter.on(handler);
	}

	/**
	 * Connect to Telegram and start receiving updates.
	 */
	async connect(): Promise<void> {
		this._logger.info('Connecting to Telegram');
		this._status = 'connecting';

		// Start transport with callbacks
		this._transport.start(
			(update) => {
				// Apply filter before processing
				if (!this._filter.shouldProcess(update)) {
					this._logger.debug({ updateId: update.update_id }, 'Update filtered out');
					return;
				}

				const event = mapUpdate(update, this.id);
				if (event) {
					this._logger.debug({ eventType: event.type, updateId: update.update_id }, 'Received inbound event');
					this._inboundEmitter.emit(event);
				}
			},
			(error) => {
				this._logger.error({ error: error.message }, 'Transport error');
				const errorEvent: ChannelErrorEvent = {
					type: 'channel_error',
					channelId: this.id,
					error: error.message,
					recoverable: true,
					timestamp: Date.now(),
				};
				this._lifecycleEmitter.emit(errorEvent);
				this._status = 'reconnecting';
			},
		);

		this._status = 'connected';
		this._logger.info('Connected to Telegram');

		const connectedEvent: ChannelConnectedEvent = {
			type: 'channel_connected',
			channelId: this.id,
			timestamp: Date.now(),
		};
		this._lifecycleEmitter.emit(connectedEvent);
	}

	/**
	 * Disconnect from Telegram and stop receiving updates.
	 */
	async disconnect(): Promise<void> {
		this._logger.info('Disconnecting from Telegram');
		this._transport.stop();
		this._status = 'disconnected';

		// Complete both emitters
		this._inboundEmitter.complete();
		this._lifecycleEmitter.complete();

		const disconnectedEvent: ChannelDisconnectedEvent = {
			type: 'channel_disconnected',
			channelId: this.id,
			timestamp: Date.now(),
		};
		this._lifecycleEmitter.emit(disconnectedEvent);
		this._logger.info('Disconnected from Telegram');
	}

	/**
	 * Register slash commands with Telegram.
	 * Uses Telegram's setMyCommands API.
	 */
	async setCommands(commands: Array<{ name: string; description: string }>): Promise<void> {
		this._logger.debug({ commandCount: commands.length }, 'Registering commands with Telegram');
		await this._transport.callApi('setMyCommands', {
			commands: commands.map((cmd) => ({
				command: cmd.name,
				description: cmd.description,
			})),
		});
		this._logger.info({ commandCount: commands.length }, 'Registered commands with Telegram');
	}

	/**
	 * Send a chat action (typing indicator).
	 */
	private async sendChatAction(chatId: number, action: string): Promise<void> {
		await this._transport.callApi('sendChatAction', { chat_id: chatId, action });
	}

	/**
	 * Send typing indicator with debouncing to avoid rate limits.
	 */
	private async sendTypingIndicator(chatId: number): Promise<void> {
		const now = Date.now();
		const lastSent = this._lastTypingAction.get(chatId) ?? 0;

		if (now - lastSent < TelegramChannel.TYPING_DEBOUNCE_MS) {
			return;
		}

		this._lastTypingAction.set(chatId, now);
		await this.sendChatAction(chatId, 'typing');
	}

	/**
	 * Send a text message.
	 */
	private async sendMessage(params: SendMessageParams): Promise<void> {
		await this._transport.callApi('sendMessage', params as unknown as Record<string, unknown>);
	}

	/**
	 * Send media content using appropriate Telegram API method.
	 */
	private async sendMedia(
		chatId: number,
		content: MediaOutbound,
		threadId?: number,
		messageId?: number,
	): Promise<void> {
		const baseParams: Record<string, unknown> = {
			chat_id: chatId,
		};

		if (threadId !== undefined) {
			baseParams.message_thread_id = threadId;
		}

		if (messageId !== undefined) {
			baseParams.reply_to_message_id = messageId;
		}

		if (content.caption) {
			baseParams.caption = content.caption;
		}

		// Get media source value
		let mediaValue: string | undefined;
		if (content.source.type === 'url') {
			mediaValue = content.source.url;
		}
		// Note: For buffer/stream sources, you'd need to use multipart form-data
		// which is more complex. For now, we only support URL sources.

		if (!mediaValue) {
			throw new Error('Only URL media sources are currently supported');
		}

		// Choose the appropriate API method based on media type
		switch (content.mediaType) {
			case 'photo':
				await this._transport.callApi('sendPhoto', { ...baseParams, photo: mediaValue });
				break;
			case 'video':
				await this._transport.callApi('sendVideo', { ...baseParams, video: mediaValue });
				break;
			case 'audio':
				await this._transport.callApi('sendAudio', { ...baseParams, audio: mediaValue });
				break;
			case 'voice':
				await this._transport.callApi('sendVoice', { ...baseParams, voice: mediaValue });
				break;
			case 'document':
				await this._transport.callApi('sendDocument', { ...baseParams, document: mediaValue });
				break;
			case 'animation':
				await this._transport.callApi('sendAnimation', { ...baseParams, animation: mediaValue });
				break;
			default: {
				const _exhaustive: never = content.mediaType;
				throw new Error(`Unsupported media type: ${_exhaustive}`);
			}
		}
	}

	/**
	 * Extract text and parse mode from OutboundContent.
	 */
	private getTextFromContent(content: OutboundContent): { text: string; parseMode?: 'MarkdownV2' | 'HTML' } {
		if (content.type === 'text') {
			return this.extractFromTextContent(content);
		}

		if (content.type === 'compound') {
			return this.extractFromCompoundContent(content);
		}

		if (content.type === 'location') {
			return { text: `Location: ${content.latitude}, ${content.longitude}` };
		}

		// Media is handled separately
		return { text: '' };
	}

	/**
	 * Extract text and parse mode from TextContent.
	 */
	private extractFromTextContent(content: TextContent): { text: string; parseMode?: 'MarkdownV2' | 'HTML' } {
		const parseMode = this.mapFormattingHint(content.formattingHint);
		return { text: content.text, parseMode };
	}

	/**
	 * Extract text from CompoundContent (combine text parts).
	 */
	private extractFromCompoundContent(content: CompoundContent): { text: string; parseMode?: 'MarkdownV2' | 'HTML' } {
		const textParts: string[] = [];
		let parseMode: 'MarkdownV2' | 'HTML' | undefined;

		for (const part of content.parts) {
			if (part.type === 'text') {
				textParts.push(part.text);
				// Use the first text part's formatting hint
				if (!parseMode) {
					parseMode = this.mapFormattingHint(part.formattingHint);
				}
			}
		}

		return { text: textParts.join('\n'), parseMode };
	}

	/**
	 * Map formatting hint to Telegram parse mode.
	 */
	private mapFormattingHint(hint?: 'plain' | 'markdown' | 'html'): 'MarkdownV2' | 'HTML' | undefined {
		switch (hint) {
			case 'markdown':
				return 'MarkdownV2';
			case 'html':
				return 'HTML';
			default:
				return undefined;
		}
	}
}
