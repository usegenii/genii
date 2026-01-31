/**
 * Message transformers for Pi agent checkpoints.
 *
 * Converts between Pi-native message format and the common checkpoint format.
 */

import type {
	AssistantMessage,
	ImageContent,
	Message,
	TextContent,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
	UserMessage,
} from '@mariozechner/pi-ai';
import type { CheckpointContent, CheckpointMessage } from '../../snapshot/types';

/**
 * Transform Pi messages to common checkpoint format.
 */
export function piMessagesToCheckpoint(messages: Message[]): CheckpointMessage[] {
	return messages.map((msg) => {
		if (msg.role === 'user') {
			return userMessageToCheckpoint(msg);
		}
		if (msg.role === 'assistant') {
			return assistantMessageToCheckpoint(msg);
		}
		if (msg.role === 'toolResult') {
			return toolResultMessageToCheckpoint(msg);
		}
		throw new Error(`Unknown message role: ${(msg as { role: string }).role}`);
	});
}

/**
 * Transform common checkpoint format back to Pi messages.
 */
export function checkpointToPiMessages(messages: CheckpointMessage[]): Message[] {
	return messages.map((msg) => {
		if (msg.role === 'user') {
			return checkpointToUserMessage(msg);
		}
		if (msg.role === 'assistant') {
			return checkpointToAssistantMessage(msg);
		}
		if (msg.role === 'tool_result') {
			return checkpointToToolResultMessage(msg);
		}
		throw new Error(`Unknown checkpoint message role: ${msg.role}`);
	});
}

// =============================================================================
// Pi -> Checkpoint transformers
// =============================================================================

function userMessageToCheckpoint(msg: UserMessage): CheckpointMessage {
	const content = normalizeUserContent(msg.content);
	return {
		role: 'user',
		content,
		timestamp: msg.timestamp,
	};
}

function assistantMessageToCheckpoint(msg: AssistantMessage): CheckpointMessage {
	const content: CheckpointContent[] = msg.content.map((c) => {
		if (c.type === 'text') {
			return { type: 'text', text: c.text };
		}
		if (c.type === 'thinking') {
			return { type: 'thinking', text: c.thinking };
		}
		if (c.type === 'toolCall') {
			return {
				type: 'tool_use',
				id: c.id,
				name: c.name,
				input: c.arguments,
			};
		}
		throw new Error(`Unknown assistant content type: ${(c as { type: string }).type}`);
	});

	return {
		role: 'assistant',
		content,
		timestamp: msg.timestamp,
		provider: msg.provider,
		model: msg.model,
	};
}

function toolResultMessageToCheckpoint(msg: ToolResultMessage): CheckpointMessage {
	const content: CheckpointContent[] = msg.content.map((c) => {
		if (c.type === 'text') {
			return { type: 'text', text: c.text };
		}
		if (c.type === 'image') {
			return { type: 'image', mediaType: c.mimeType, data: c.data };
		}
		throw new Error(`Unknown tool result content type: ${(c as { type: string }).type}`);
	});

	return {
		role: 'tool_result',
		content,
		timestamp: msg.timestamp,
		toolCallId: msg.toolCallId,
		toolName: msg.toolName,
		isError: msg.isError,
	};
}

function normalizeUserContent(content: string | (TextContent | ImageContent)[]): CheckpointContent[] {
	if (typeof content === 'string') {
		return [{ type: 'text', text: content }];
	}

	return content.map((c) => {
		if (c.type === 'text') {
			return { type: 'text', text: c.text };
		}
		if (c.type === 'image') {
			return { type: 'image', mediaType: c.mimeType, data: c.data };
		}
		throw new Error(`Unknown user content type: ${(c as { type: string }).type}`);
	});
}

// =============================================================================
// Checkpoint -> Pi transformers
// =============================================================================

function checkpointToUserMessage(msg: CheckpointMessage): UserMessage {
	const content = msg.content.map((c) => {
		if (c.type === 'text') {
			return { type: 'text' as const, text: c.text };
		}
		if (c.type === 'image') {
			return { type: 'image' as const, mimeType: c.mediaType, data: c.data };
		}
		throw new Error(`Invalid content type for user message: ${c.type}`);
	});

	return {
		role: 'user',
		content,
		timestamp: msg.timestamp,
	};
}

function checkpointToAssistantMessage(msg: CheckpointMessage): AssistantMessage {
	const content: (TextContent | ThinkingContent | ToolCall)[] = msg.content.map((c) => {
		if (c.type === 'text') {
			return { type: 'text' as const, text: c.text };
		}
		if (c.type === 'thinking') {
			return { type: 'thinking' as const, thinking: c.text };
		}
		if (c.type === 'tool_use') {
			return {
				type: 'toolCall' as const,
				id: c.id,
				name: c.name,
				arguments: c.input as Record<string, unknown>,
			};
		}
		throw new Error(`Invalid content type for assistant message: ${c.type}`);
	});

	return {
		role: 'assistant',
		content,
		timestamp: msg.timestamp,
		// Restore provider metadata with defaults
		api: 'anthropic-messages',
		provider: msg.provider ?? 'unknown',
		model: msg.model ?? 'unknown',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
	};
}

function checkpointToToolResultMessage(msg: CheckpointMessage): ToolResultMessage {
	const content: (TextContent | ImageContent)[] = msg.content.map((c) => {
		if (c.type === 'text') {
			return { type: 'text' as const, text: c.text };
		}
		if (c.type === 'image') {
			return { type: 'image' as const, mimeType: c.mediaType, data: c.data };
		}
		throw new Error(`Invalid content type for tool result message: ${c.type}`);
	});

	return {
		role: 'toolResult',
		content,
		timestamp: msg.timestamp,
		toolCallId: msg.toolCallId ?? '',
		toolName: msg.toolName ?? '',
		isError: msg.isError ?? false,
	};
}
