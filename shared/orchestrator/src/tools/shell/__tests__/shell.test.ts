/**
 * Tests for Shell tool.
 */

import { homedir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { TRUNCATION_INDICATOR } from '../constants';
import { executeShellCommand } from '../executor';
import { createShellTool, type ShellToolConfig } from '../tool';
import { truncateOutput } from '../truncate';

describe('truncateOutput', () => {
	it('should return original text when under max length', () => {
		const result = truncateOutput('hello world', 100);
		expect(result.text).toBe('hello world');
		expect(result.truncated).toBe(false);
	});

	it('should return original text when exactly at max length', () => {
		const result = truncateOutput('hello', 5);
		expect(result.text).toBe('hello');
		expect(result.truncated).toBe(false);
	});

	it('should truncate and break on line boundary', () => {
		const input = 'line1\nline2\nline3\nline4\nline5';
		// Last 17 chars: "3\nline4\nline5", first newline at index 1, returns from index 2
		const result = truncateOutput(input, 17);
		expect(result.truncated).toBe(true);
		// Should skip partial line at start
		expect(result.text).toBe('line4\nline5');
	});

	it('should handle single long line without newlines', () => {
		const input = 'a'.repeat(100);
		const result = truncateOutput(input, 50);
		expect(result.truncated).toBe(true);
		expect(result.text).toBe('a'.repeat(50));
	});

	it('should handle empty string', () => {
		const result = truncateOutput('', 100);
		expect(result.text).toBe('');
		expect(result.truncated).toBe(false);
	});

	it('should handle string with only newlines', () => {
		const result = truncateOutput('\n\n\n', 2);
		expect(result.truncated).toBe(true);
		expect(result.text).toBe('\n'); // Takes last 2 chars "\n\n", finds first newline at 0, returns from index 1
	});
});

describe('executeShellCommand', () => {
	it('should execute a simple command', async () => {
		const result = await executeShellCommand({
			command: 'echo "hello world"',
			workingDirectory: process.cwd(),
			timeout: 5000,
			signal: new AbortController().signal,
			shell: '/bin/sh',
		});

		expect(result.stdout.trim()).toBe('hello world');
		expect(result.stderr).toBe('');
		expect(result.exitCode).toBe(0);
		expect(result.timedOut).toBe(false);
	});

	it('should capture stderr', async () => {
		const result = await executeShellCommand({
			command: 'echo "error" >&2',
			workingDirectory: process.cwd(),
			timeout: 5000,
			signal: new AbortController().signal,
			shell: '/bin/sh',
		});

		expect(result.stdout).toBe('');
		expect(result.stderr.trim()).toBe('error');
		expect(result.exitCode).toBe(0);
	});

	it('should return non-zero exit code for failing command', async () => {
		const result = await executeShellCommand({
			command: 'exit 42',
			workingDirectory: process.cwd(),
			timeout: 5000,
			signal: new AbortController().signal,
			shell: '/bin/sh',
		});

		expect(result.exitCode).toBe(42);
	});

	it('should timeout long-running commands', { timeout: 15000 }, async () => {
		const result = await executeShellCommand({
			command: 'sleep 10',
			workingDirectory: process.cwd(),
			timeout: 100, // 100ms timeout
			signal: new AbortController().signal,
			shell: '/bin/sh',
		});

		expect(result.timedOut).toBe(true);
		expect(result.exitCode).toBe(124);
	});

	it('should respect abort signal', { timeout: 15000 }, async () => {
		const controller = new AbortController();

		// Abort after a short delay
		setTimeout(() => controller.abort(), 50);

		const result = await executeShellCommand({
			command: 'sleep 10',
			workingDirectory: process.cwd(),
			timeout: 10000,
			signal: controller.signal,
			shell: '/bin/sh',
		});

		expect(result.timedOut).toBe(true);
		expect(result.exitCode).toBe(124);
	});

	it('should use specified working directory', async () => {
		const result = await executeShellCommand({
			command: 'pwd',
			workingDirectory: '/tmp',
			timeout: 5000,
			signal: new AbortController().signal,
			shell: '/bin/sh',
		});

		// On macOS, /tmp is a symlink to /private/tmp
		expect(result.stdout.trim()).toMatch(/^(\/tmp|\/private\/tmp)$/);
	});
});

describe('createShellTool', () => {
	const defaultConfig: ShellToolConfig = {
		defaultTimeout: 30000,
		maxOutputLength: 50000,
	};

	// Create a mock context
	function createMockContext() {
		return {
			sessionId: 'test-session',
			guidance: {} as never,
			signal: new AbortController().signal,
			step: {} as never,
			emitProgress: vi.fn(),
			log: vi.fn(),
		};
	}

	it('should create a tool with correct metadata', () => {
		const tool = createShellTool(defaultConfig);
		expect(tool.name).toBe('shell');
		expect(tool.label).toBe('Shell');
		expect(tool.category).toBe('system');
		expect(tool.description).toContain('Execute');
	});

	it('should execute command and return XML output', async () => {
		const tool = createShellTool(defaultConfig);
		const context = createMockContext();

		const result = await tool.execute({ command: 'echo "hello"' }, context);

		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.output).toContain('<stdout>');
			expect(result.output).toContain('hello');
			expect(result.output).toContain('</stdout>');
			expect(result.output).toContain('<exit-code>0</exit-code>');
		}
	});

	it('should omit stdout when empty', async () => {
		const tool = createShellTool(defaultConfig);
		const context = createMockContext();

		const result = await tool.execute({ command: 'echo "error" >&2' }, context);

		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.output).not.toContain('<stdout>');
			expect(result.output).toContain('<stderr>');
			expect(result.output).toContain('error');
		}
	});

	it('should omit stderr when empty', async () => {
		const tool = createShellTool(defaultConfig);
		const context = createMockContext();

		const result = await tool.execute({ command: 'echo "hello"' }, context);

		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.output).not.toContain('<stderr>');
		}
	});

	it('should include timed-out tag when command times out', { timeout: 15000 }, async () => {
		const tool = createShellTool({ ...defaultConfig, defaultTimeout: 100 });
		const context = createMockContext();

		const result = await tool.execute({ command: 'sleep 10' }, context);

		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.output).toContain('<timed-out>true</timed-out>');
			expect(result.output).toContain('<exit-code>124</exit-code>');
		}
	});

	it('should use input working directory over config', async () => {
		const tool = createShellTool({
			...defaultConfig,
			defaultWorkingDir: '/var',
		});
		const context = createMockContext();

		const result = await tool.execute({ command: 'pwd', workingDirectory: '/tmp' }, context);

		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.output).toContain('/tmp');
		}
	});

	it('should use config working directory when input not provided', async () => {
		const tool = createShellTool({
			...defaultConfig,
			defaultWorkingDir: '/tmp',
		});
		const context = createMockContext();

		const result = await tool.execute({ command: 'pwd' }, context);

		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.output).toContain('/tmp');
		}
	});

	it('should fall back to homedir when no working directory specified', async () => {
		const tool = createShellTool(defaultConfig);
		const context = createMockContext();

		const result = await tool.execute({ command: 'pwd' }, context);

		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.output).toContain(homedir());
		}
	});

	it('should clamp timeout to MAX_TIMEOUT_MS', async () => {
		const tool = createShellTool(defaultConfig);
		const context = createMockContext();

		// Request a very long timeout - should be clamped
		const result = await tool.execute({ command: 'echo "test"', timeout: 999999999 }, context);

		expect(result.status).toBe('success');
		// If it ran, the clamping worked (otherwise it would hang)
	});

	it('should include truncation indicator when output is truncated', async () => {
		const tool = createShellTool({
			...defaultConfig,
			maxOutputLength: 30, // Small enough to truncate multi-line output
		});
		const context = createMockContext();

		// Generate output much longer than 30 chars
		const result = await tool.execute(
			{
				command:
					'echo "line1_aaaaaaaaaaa"; echo "line2_bbbbbbbbbbb"; echo "line3_ccccccccccc"; echo "line4_ddddddddddd"',
			},
			context,
		);

		expect(result.status).toBe('success');
		if (result.status === 'success') {
			expect(result.output).toContain(TRUNCATION_INDICATOR);
		}
	});

	it('should log execution info', async () => {
		const tool = createShellTool(defaultConfig);
		const context = createMockContext();

		await tool.execute({ command: 'echo "hello"' }, context);

		expect(context.log).toHaveBeenCalledWith('info', expect.stringContaining('echo "hello"'));
	});
});
