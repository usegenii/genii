/**
 * Telegram long-polling transport for receiving updates.
 */

import type { TelegramApiResponse, TelegramConfig, TelegramUpdate } from './types';

/**
 * Default delay before retrying after an error (in milliseconds).
 */
const RETRY_DELAY_MS = 1000;

/**
 * Handles long-polling for receiving updates from Telegram.
 */
export class TelegramTransport {
	private readonly token: string;
	private readonly baseUrl: string;
	private readonly pollingTimeout: number;
	private readonly allowedUpdates?: string[];

	private _running = false;
	private _offset = 0;
	private _abortController: AbortController | null = null;

	constructor(config: TelegramConfig) {
		this.token = config.token;
		this.baseUrl = config.baseUrl ?? 'https://api.telegram.org';
		this.pollingTimeout = config.pollingTimeout ?? 30;
		this.allowedUpdates = config.allowedUpdates;
	}

	/**
	 * Start the long-polling loop.
	 * @param onUpdate - Callback invoked for each update received
	 * @param onError - Callback invoked when an error occurs
	 */
	async start(onUpdate: (update: TelegramUpdate) => void, onError: (error: Error) => void): Promise<void> {
		this._running = true;
		this._abortController = new AbortController();

		while (this._running) {
			try {
				const updates = await this.getUpdates();

				for (const update of updates) {
					onUpdate(update);
					this._offset = update.update_id + 1;
				}
			} catch (error) {
				// Handle abort gracefully - just stop the loop
				if (error instanceof Error && error.name === 'AbortError') {
					break;
				}

				// Report other errors and wait before retrying
				onError(error instanceof Error ? error : new Error(String(error)));
				await this.delay(RETRY_DELAY_MS);
			}
		}
	}

	/**
	 * Stop the long-polling loop.
	 */
	stop(): void {
		this._running = false;
		this._abortController?.abort();
	}

	/**
	 * Fetch updates from the Telegram API using long polling.
	 */
	private async getUpdates(): Promise<TelegramUpdate[]> {
		const url = `${this.baseUrl}/bot${this.token}/getUpdates`;

		const body: Record<string, unknown> = {
			offset: this._offset,
			timeout: this.pollingTimeout,
		};

		if (this.allowedUpdates) {
			body.allowed_updates = this.allowedUpdates;
		}

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
			signal: this._abortController?.signal,
		});

		const data = (await response.json()) as TelegramApiResponse<TelegramUpdate[]>;

		if (!data.ok) {
			throw new Error(`Telegram API error: ${data.description ?? 'Unknown error'} (code: ${data.error_code})`);
		}

		return data.result ?? [];
	}

	/**
	 * Call any Telegram Bot API method.
	 * @param method - The API method name (e.g., 'sendMessage')
	 * @param params - Optional parameters for the API call
	 * @returns The result from the API
	 */
	async callApi<T>(method: string, params?: Record<string, unknown>): Promise<T> {
		const url = `${this.baseUrl}/bot${this.token}/${method}`;

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: params ? JSON.stringify(params) : undefined,
		});

		const data = (await response.json()) as TelegramApiResponse<T>;

		if (!data.ok) {
			throw new Error(`Telegram API error: ${data.description ?? 'Unknown error'} (code: ${data.error_code})`);
		}

		return data.result as T;
	}

	/**
	 * Helper to create a delay.
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
