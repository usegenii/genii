import { describe, expect, it } from 'vitest';
import { createFrameDecoder, decode, encode, encodeString, LineDecoder } from '../codec';

describe('encode()', () => {
	it('should encode an object to a Buffer with newline terminator', () => {
		const message = { type: 'test', value: 42 };
		const result = encode(message);

		expect(result).toBeInstanceOf(Buffer);
		expect(result.toString('utf8')).toBe('{"type":"test","value":42}\n');
	});

	it('should encode nested objects correctly', () => {
		const message = { foo: { bar: { baz: 'deep' } } };
		const result = encode(message);

		expect(result.toString('utf8')).toBe('{"foo":{"bar":{"baz":"deep"}}}\n');
	});

	it('should handle arrays in messages', () => {
		const message = { items: [1, 2, 3] };
		const result = encode(message);

		expect(result.toString('utf8')).toBe('{"items":[1,2,3]}\n');
	});

	it('should handle empty objects', () => {
		const message = {};
		const result = encode(message);

		expect(result.toString('utf8')).toBe('{}\n');
	});
});

describe('encodeString()', () => {
	it('should encode an object to a string with newline terminator', () => {
		const message = { type: 'test', value: 42 };
		const result = encodeString(message);

		expect(result).toBe('{"type":"test","value":42}\n');
	});
});

describe('decode()', () => {
	it('should decode a Buffer containing a single NDJSON message', () => {
		const data = Buffer.from('{"type":"test","value":42}\n', 'utf8');
		const result = decode(data);

		expect(result).toEqual([{ type: 'test', value: 42 }]);
	});

	it('should decode multiple NDJSON messages', () => {
		const data = Buffer.from('{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n', 'utf8');
		const result = decode(data);

		expect(result).toEqual([{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
	});

	it('should skip empty lines', () => {
		const data = Buffer.from('{"type":"a"}\n\n{"type":"b"}\n', 'utf8');
		const result = decode(data);

		expect(result).toEqual([{ type: 'a' }, { type: 'b' }]);
	});

	it('should skip malformed JSON lines', () => {
		const data = Buffer.from('{"type":"a"}\nnot json\n{"type":"b"}\n', 'utf8');
		const result = decode(data);

		expect(result).toEqual([{ type: 'a' }, { type: 'b' }]);
	});

	it('should skip non-object JSON values', () => {
		const data = Buffer.from('{"type":"a"}\n123\n"string"\n{"type":"b"}\n', 'utf8');
		const result = decode(data);

		expect(result).toEqual([{ type: 'a' }, { type: 'b' }]);
	});

	it('should handle data without trailing newline', () => {
		const data = Buffer.from('{"type":"a"}\n{"type":"b"}', 'utf8');
		const result = decode(data);

		expect(result).toEqual([{ type: 'a' }, { type: 'b' }]);
	});

	it('should return empty array for empty Buffer', () => {
		const data = Buffer.from('', 'utf8');
		const result = decode(data);

		expect(result).toEqual([]);
	});

	it('should handle whitespace-only input', () => {
		const data = Buffer.from('   \n\n   \n', 'utf8');
		const result = decode(data);

		expect(result).toEqual([]);
	});
});

describe('LineDecoder', () => {
	describe('feed()', () => {
		it('should decode complete messages from string input', () => {
			const decoder = new LineDecoder();
			const result = decoder.feed('{"type":"test"}\n');

			expect(result).toEqual([{ type: 'test' }]);
		});

		it('should decode complete messages from Buffer input', () => {
			const decoder = new LineDecoder();
			const result = decoder.feed(Buffer.from('{"type":"test"}\n', 'utf8'));

			expect(result).toEqual([{ type: 'test' }]);
		});

		it('should handle partial data by buffering', () => {
			const decoder = new LineDecoder();

			// Send partial message
			const result1 = decoder.feed('{"type":');
			expect(result1).toEqual([]);

			// Complete the message
			const result2 = decoder.feed('"test"}\n');
			expect(result2).toEqual([{ type: 'test' }]);
		});

		it('should handle multiple messages split across chunks', () => {
			const decoder = new LineDecoder();

			// First chunk contains partial second message
			const result1 = decoder.feed('{"a":1}\n{"b":');
			expect(result1).toEqual([{ a: 1 }]);

			// Complete second message
			const result2 = decoder.feed('2}\n');
			expect(result2).toEqual([{ b: 2 }]);
		});

		it('should handle multiple complete messages in one chunk', () => {
			const decoder = new LineDecoder();
			const result = decoder.feed('{"a":1}\n{"b":2}\n{"c":3}\n');

			expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
		});

		it('should skip malformed JSON', () => {
			const decoder = new LineDecoder();
			const result = decoder.feed('not json\n{"valid":true}\n');

			expect(result).toEqual([{ valid: true }]);
		});

		it('should handle empty lines', () => {
			const decoder = new LineDecoder();
			const result = decoder.feed('{"a":1}\n\n{"b":2}\n');

			expect(result).toEqual([{ a: 1 }, { b: 2 }]);
		});
	});

	describe('reset()', () => {
		it('should clear the internal buffer', () => {
			const decoder = new LineDecoder();

			// Send partial message
			decoder.feed('{"type":');
			expect(decoder.hasPending).toBe(true);

			// Reset the decoder
			decoder.reset();
			expect(decoder.hasPending).toBe(false);

			// Sending a complete new message should work
			const result = decoder.feed('{"new":"message"}\n');
			expect(result).toEqual([{ new: 'message' }]);
		});
	});

	describe('hasPending', () => {
		it('should return false when buffer is empty', () => {
			const decoder = new LineDecoder();
			expect(decoder.hasPending).toBe(false);
		});

		it('should return true when there is pending data', () => {
			const decoder = new LineDecoder();
			decoder.feed('{"incomplete":');
			expect(decoder.hasPending).toBe(true);
		});

		it('should return false after buffer is consumed', () => {
			const decoder = new LineDecoder();
			decoder.feed('{"complete":true}\n');
			expect(decoder.hasPending).toBe(false);
		});
	});

	describe('pending', () => {
		it('should return the current buffer contents', () => {
			const decoder = new LineDecoder();
			decoder.feed('{"partial":"');
			expect(decoder.pending).toBe('{"partial":"');
		});

		it('should return empty string when no pending data', () => {
			const decoder = new LineDecoder();
			expect(decoder.pending).toBe('');
		});
	});
});

describe('createFrameDecoder()', () => {
	it('should return an object with feed, reset, and hasPending methods', () => {
		const frameDecoder = createFrameDecoder();

		expect(typeof frameDecoder.feed).toBe('function');
		expect(typeof frameDecoder.reset).toBe('function');
		expect(typeof frameDecoder.hasPending).toBe('function');
	});

	describe('feed()', () => {
		it('should decode Buffer input and return objects', () => {
			const frameDecoder = createFrameDecoder();
			const result = frameDecoder.feed(Buffer.from('{"type":"test"}\n', 'utf8'));

			expect(result).toEqual([{ type: 'test' }]);
		});

		it('should handle partial data correctly', () => {
			const frameDecoder = createFrameDecoder();

			const result1 = frameDecoder.feed(Buffer.from('{"type":', 'utf8'));
			expect(result1).toEqual([]);

			const result2 = frameDecoder.feed(Buffer.from('"test"}\n', 'utf8'));
			expect(result2).toEqual([{ type: 'test' }]);
		});

		it('should filter out non-object results', () => {
			const frameDecoder = createFrameDecoder();
			const result = frameDecoder.feed(Buffer.from('123\n"string"\nnull\n{"valid":true}\n', 'utf8'));

			expect(result).toEqual([{ valid: true }]);
		});
	});

	describe('reset()', () => {
		it('should reset the internal decoder', () => {
			const frameDecoder = createFrameDecoder();

			frameDecoder.feed(Buffer.from('{"partial":', 'utf8'));
			expect(frameDecoder.hasPending()).toBe(true);

			frameDecoder.reset();
			expect(frameDecoder.hasPending()).toBe(false);
		});
	});

	describe('hasPending()', () => {
		it('should return false when no pending data', () => {
			const frameDecoder = createFrameDecoder();
			expect(frameDecoder.hasPending()).toBe(false);
		});

		it('should return true when there is pending data', () => {
			const frameDecoder = createFrameDecoder();
			frameDecoder.feed(Buffer.from('{"incomplete":', 'utf8'));
			expect(frameDecoder.hasPending()).toBe(true);
		});
	});
});
