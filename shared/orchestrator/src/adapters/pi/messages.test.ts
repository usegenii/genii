import type { Message } from '@mariozechner/pi-ai';
import { describe, expect, it } from 'vitest';
import type { CheckpointMessage } from '../../snapshot/types';
import { checkpointToPiMessages, piMessagesToCheckpoint } from './messages';

describe('Pi checkpoint message transforms', () => {
	it('preserves opaque content signatures in both directions', () => {
		const messages: Message[] = [
			{
				role: 'user',
				content: [{ type: 'text', text: 'Question', textSignature: 'user-text-signature' }],
				timestamp: 1,
			},
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Answer', textSignature: 'assistant-text-signature' },
					{ type: 'thinking', thinking: 'Reasoning', thinkingSignature: 'thinking-signature' },
					{
						type: 'toolCall',
						id: 'call-1',
						name: 'lookup',
						arguments: { query: 'value' },
						thoughtSignature: 'tool-thought-signature',
					},
				],
				api: 'google-generative-ai',
				provider: 'google',
				model: 'gemini-test',
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: 'toolUse',
				timestamp: 2,
			},
			{
				role: 'toolResult',
				toolCallId: 'call-1',
				toolName: 'lookup',
				content: [{ type: 'text', text: 'Result', textSignature: 'tool-result-text-signature' }],
				isError: false,
				timestamp: 3,
			},
		];

		const checkpointMessages = piMessagesToCheckpoint(messages);

		expect(checkpointMessages.at(1)).toMatchObject({
			api: 'google-generative-ai',
			provider: 'google',
			model: 'gemini-test',
		});
		expect(checkpointMessages.map((message) => message.content)).toEqual([
			[{ type: 'text', text: 'Question', textSignature: 'user-text-signature' }],
			[
				{ type: 'text', text: 'Answer', textSignature: 'assistant-text-signature' },
				{ type: 'thinking', text: 'Reasoning', thinkingSignature: 'thinking-signature' },
				{
					type: 'tool_use',
					id: 'call-1',
					name: 'lookup',
					input: { query: 'value' },
					thoughtSignature: 'tool-thought-signature',
				},
			],
			[{ type: 'text', text: 'Result', textSignature: 'tool-result-text-signature' }],
		]);

		const restoredMessages = checkpointToPiMessages(checkpointMessages);
		expect(restoredMessages.at(1)).toMatchObject({
			role: 'assistant',
			api: 'google-generative-ai',
			provider: 'google',
			model: 'gemini-test',
		});
		expect(restoredMessages.map((message) => message.content)).toEqual(messages.map((message) => message.content));
	});

	it('restores checkpoints created before signatures and provider API metadata were stored', () => {
		const checkpointMessages: CheckpointMessage[] = [
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Answer' },
					{ type: 'thinking', text: 'Reasoning' },
					{ type: 'tool_use', id: 'call-1', name: 'lookup', input: { query: 'value' } },
				],
				timestamp: 1,
				provider: 'google',
				model: 'gemini-test',
			},
		];

		const restoredMessages = checkpointToPiMessages(checkpointMessages);
		expect(restoredMessages.at(0)).toMatchObject({
			role: 'assistant',
			api: 'anthropic-messages',
		});
		expect(piMessagesToCheckpoint(restoredMessages)).toEqual([
			{ ...checkpointMessages[0], api: 'anthropic-messages' },
		]);
	});
});
