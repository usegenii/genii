import { describe, expect, it } from 'vitest';
import { createTelegramAdapter, TelegramAdapter } from '../adapter';
import { TelegramChannel } from '../channel';

describe('TelegramAdapter', () => {
	describe('name', () => {
		it('should be "telegram"', () => {
			const adapter = new TelegramAdapter();

			expect(adapter.name).toBe('telegram');
		});
	});

	describe('create()', () => {
		it('should create a TelegramChannel', () => {
			const adapter = new TelegramAdapter();
			const config = { token: 'test-bot-token' };

			const channel = adapter.create(config);

			expect(channel).toBeInstanceOf(TelegramChannel);
		});
	});
});

describe('createTelegramAdapter()', () => {
	it('should create a TelegramAdapter instance', () => {
		const adapter = createTelegramAdapter();

		expect(adapter).toBeInstanceOf(TelegramAdapter);
	});
});
