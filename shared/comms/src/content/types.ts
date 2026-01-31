// Media Reference - platform-specific file identifier
export interface MediaReference {
	platform: string;
	id: string; // file_id for Telegram, etc.
}

// Media Source - for outbound media
export type MediaSource =
	| { type: 'url'; url: string }
	| { type: 'buffer'; data: Uint8Array; mimeType: string }
	| { type: 'stream'; stream: ReadableStream<Uint8Array>; mimeType: string };

// Text Content
export interface TextContent {
	type: 'text';
	text: string;
}

// Media Content (inbound)
export interface MediaContent {
	type: 'media';
	mediaType: 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'animation';
	mimeType?: string;
	filename?: string;
	size?: number;
	caption?: string;
	reference: MediaReference;
}

// Media Outbound (for sending)
export interface MediaOutbound {
	type: 'media';
	mediaType: 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'animation';
	source: MediaSource;
	caption?: string;
	filename?: string;
}

// Location Content
export interface LocationContent {
	type: 'location';
	latitude: number;
	longitude: number;
}

// Contact Content
export interface ContactContent {
	type: 'contact';
	phoneNumber: string;
	firstName: string;
	lastName?: string;
}

// Sticker Content
export interface StickerContent {
	type: 'sticker';
	emoji?: string;
	reference: MediaReference;
}

// Poll Vote Content
export interface PollVoteContent {
	type: 'poll_vote';
	pollId: string;
	selectedOptions: number[];
}

// Compound Content (for complex outbound messages with multiple parts)
export interface CompoundContent {
	type: 'compound';
	parts: Array<TextContent | MediaOutbound>;
}

// Author
export interface Author {
	id: string;
	username?: string;
	displayName?: string;
	isBot: boolean;
}

// Reaction
export interface Reaction {
	emoji: string;
	customEmojiId?: string;
}

// Inbound Content - Union type for all possible inbound message content types
export type InboundContent =
	| TextContent
	| MediaContent
	| LocationContent
	| ContactContent
	| StickerContent
	| PollVoteContent;

// Outbound Content - Union type for all possible outbound message content types
export type OutboundContent = TextContent | MediaOutbound | LocationContent | CompoundContent;
