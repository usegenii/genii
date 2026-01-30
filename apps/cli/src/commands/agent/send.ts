/**
 * Agent send command.
 * @module commands/agent/send
 */

import * as readline from 'node:readline';
import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Read message from stdin.
 */
async function readFromStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			terminal: false,
		});

		const lines: string[] = [];

		rl.on('line', (line) => {
			lines.push(line);
		});

		rl.on('close', () => {
			resolve(lines.join('\n'));
		});

		rl.on('error', (err) => {
			reject(err);
		});
	});
}

/**
 * Send a message to an agent.
 */
export function sendCommand(agent: Command): void {
	agent
		.command('send <agent-id> [message]')
		.description('Send a message to an agent')
		.option('--stdin', 'Read message from stdin')
		.action(async (agentId: string, message: string | undefined, options) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				// Determine the message content
				let content: string;

				if (options.stdin) {
					// Read from stdin
					content = await readFromStdin();
				} else if (message) {
					content = message;
				} else {
					formatter.error(new Error('Message is required. Provide it as an argument or use --stdin'));
					process.exit(1);
				}

				if (!content.trim()) {
					formatter.error(new Error('Message cannot be empty'));
					process.exit(1);
				}

				await client.connect();

				// Send the message to the agent
				await client.sendToAgent(agentId, content, 'user');

				// Output based on format
				if (format === 'json') {
					formatter.success({
						id: agentId,
						sent: true,
						messageLength: content.length,
					});
				} else if (format === 'quiet') {
					// In quiet mode, output nothing on success
				} else {
					// Human-readable output
					formatter.message(`Message sent to agent ${agentId}`, 'success');
				}
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
