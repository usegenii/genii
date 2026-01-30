/**
 * JSON line framing codec for transport layer.
 *
 * Uses newline-delimited JSON (NDJSON) for message framing:
 * - Each message is a single JSON object on its own line
 * - Messages are separated by newlines
 * - Handles partial reads and buffering
 */

/**
 * Encode a message for transport.
 *
 * @param message - The message object to encode
 * @returns The encoded Buffer with newline terminator
 */
export function encode(message: object): Buffer {
	const json = JSON.stringify(message);
	return Buffer.from(`${json}\n`, 'utf8');
}

/**
 * Encode a message to a string for transport.
 *
 * @param message - The message object to encode
 * @returns The encoded string with newline terminator
 */
export function encodeString(message: object): string {
	return `${JSON.stringify(message)}\n`;
}

/**
 * Decode a buffer containing one or more NDJSON messages.
 *
 * @param data - The buffer to decode
 * @returns Array of decoded message objects
 */
export function decode(data: Buffer): object[] {
	const str = data.toString('utf8');
	const lines = str.split('\n');
	const messages: object[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed) {
			try {
				const parsed = JSON.parse(trimmed);
				if (typeof parsed === 'object' && parsed !== null) {
					messages.push(parsed);
				}
			} catch {
				// Skip malformed JSON lines
			}
		}
	}

	return messages;
}

/**
 * Decoder for streaming JSON line messages.
 *
 * Handles partial reads by buffering incomplete lines.
 */
export class LineDecoder {
	private _buffer = '';

	/**
	 * Feed data into the decoder.
	 *
	 * @param data - The data chunk to process (string or Buffer)
	 * @returns Array of decoded messages
	 */
	feed(data: string | Buffer): unknown[] {
		const str = typeof data === 'string' ? data : data.toString('utf8');
		this._buffer += str;
		const messages: unknown[] = [];
		const lines = this._buffer.split('\n');

		// Keep the last incomplete line in the buffer
		this._buffer = lines.pop() ?? '';

		for (const line of lines) {
			if (line.trim()) {
				try {
					messages.push(JSON.parse(line));
				} catch {
					// Skip malformed JSON
				}
			}
		}

		return messages;
	}

	/**
	 * Reset the decoder buffer.
	 */
	reset(): void {
		this._buffer = '';
	}

	/**
	 * Check if there's pending data in the buffer.
	 */
	get hasPending(): boolean {
		return this._buffer.length > 0;
	}

	/**
	 * Get any remaining data in the buffer (for error reporting).
	 */
	get pending(): string {
		return this._buffer;
	}
}

/**
 * Create a frame decoder for streaming data.
 *
 * Returns an object with methods to feed data and retrieve decoded messages.
 *
 * @returns A frame decoder instance
 */
export function createFrameDecoder(): {
	feed: (data: Buffer) => object[];
	reset: () => void;
	hasPending: () => boolean;
} {
	const decoder = new LineDecoder();

	return {
		/**
		 * Feed data into the decoder.
		 *
		 * @param data - The buffer to process
		 * @returns Array of decoded message objects
		 */
		feed(data: Buffer): object[] {
			const messages = decoder.feed(data);
			return messages.filter((m): m is object => typeof m === 'object' && m !== null);
		},

		/**
		 * Reset the decoder buffer.
		 */
		reset(): void {
			decoder.reset();
		},

		/**
		 * Check if there's pending data in the buffer.
		 */
		hasPending(): boolean {
			return decoder.hasPending;
		},
	};
}

/**
 * Create a framed message handler.
 *
 * Wraps a message handler to automatically decode incoming data.
 *
 * @param handler - The handler for decoded messages
 * @returns A data handler function
 */
export function createFramedHandler(handler: (message: unknown) => void): (data: string | Buffer) => void {
	const decoder = new LineDecoder();

	return (data: string | Buffer) => {
		const messages = decoder.feed(data);
		for (const message of messages) {
			handler(message);
		}
	};
}
