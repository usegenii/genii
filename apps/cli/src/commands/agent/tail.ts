/**
 * Agent tail command.
 * @module commands/agent/tail
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { formatTimestamp } from '../../utils/time';

/**
 * Event types that can be included in tail output.
 */
type IncludeType = 'thinking' | 'tools';

/**
 * Parse include option.
 */
function parseIncludeOption(include: string | undefined): Set<IncludeType> {
	if (!include) {
		return new Set();
	}
	const types = include.split(',').map((t) => t.trim().toLowerCase()) as IncludeType[];
	const validTypes: IncludeType[] = ['thinking', 'tools'];
	for (const t of types) {
		if (!validTypes.includes(t)) {
			throw new Error(`Invalid include type: ${t}. Valid types: ${validTypes.join(', ')}`);
		}
	}
	return new Set(types);
}

/**
 * Format a tool call for display.
 */
function formatToolCall(toolCall: unknown): string {
	if (typeof toolCall !== 'object' || toolCall === null) {
		return String(toolCall);
	}

	const tc = toolCall as Record<string, unknown>;
	const name = tc.name ?? 'unknown';
	const args = tc.arguments ?? tc.args ?? {};

	const argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
	return `${chalk.cyan(String(name))}(${chalk.gray(argsStr)})`;
}

/**
 * Format thinking content for display.
 */
function formatThinking(thinking: unknown): string {
	if (typeof thinking === 'string') {
		return chalk.dim.italic(thinking);
	}
	return chalk.dim.italic(JSON.stringify(thinking));
}

/**
 * Format output event for human display.
 */
function formatOutputEvent(
	event: Record<string, unknown>,
	includeTypes: Set<IncludeType>,
	showTimestamps: boolean,
): string | null {
	const eventType = event.type as string;
	const timestamp = showTimestamps ? `${chalk.gray(formatTimestamp(Date.now()))} ` : '';

	switch (eventType) {
		case 'text':
		case 'content':
		case 'message':
			return `${timestamp}${event.content ?? event.text ?? ''}`;

		case 'thinking':
			if (!includeTypes.has('thinking')) {
				return null;
			}
			return `${timestamp}${chalk.magenta('[thinking]')} ${formatThinking(event.content ?? event.thinking)}`;

		case 'tool_call':
		case 'tool':
			if (!includeTypes.has('tools')) {
				return null;
			}
			return `${timestamp}${chalk.yellow('[tool]')} ${formatToolCall(event)}`;

		case 'tool_result':
			if (!includeTypes.has('tools')) {
				return null;
			}
			return `${timestamp}${chalk.green('[result]')} ${chalk.gray(String(event.result ?? event.output ?? ''))}`;

		case 'error':
			return `${timestamp}${chalk.red('[error]')} ${event.message ?? event.error ?? 'Unknown error'}`;

		case 'done':
		case 'complete':
			return `${timestamp}${chalk.blue('[done]')}`;

		default:
			// For unknown event types, output the raw content if any
			if (event.content) {
				return `${timestamp}${event.content}`;
			}
			return null;
	}
}

/**
 * Tail agent output (follow logs/activity).
 */
export function tailCommand(agent: Command): void {
	agent
		.command('tail <agent-id>')
		.description('Follow agent output in real-time')
		.option('--include <types>', 'Include thinking and/or tool events (thinking,tools)')
		.action(async (agentId: string, options) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			// Parse include option
			let includeTypes: Set<IncludeType>;
			try {
				includeTypes = parseIncludeOption(options.include);
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			}

			const client = createDaemonClient();
			let subscriptionId: string | null = null;
			let unsubscribeHandler: (() => void) | null = null;

			// Setup cleanup handler for Ctrl+C
			const cleanup = async () => {
				if (subscriptionId && client.connected) {
					try {
						await client.unsubscribe(subscriptionId);
					} catch {
						// Ignore unsubscribe errors during cleanup
					}
				}
				if (unsubscribeHandler) {
					unsubscribeHandler();
				}
				await client.disconnect();
				process.exit(0);
			};

			process.on('SIGINT', () => {
				void cleanup();
			});
			process.on('SIGTERM', () => {
				void cleanup();
			});

			try {
				await client.connect();

				// First verify the agent exists
				try {
					await client.getAgent(agentId);
				} catch {
					formatter.error(new Error(`Agent not found: ${agentId}`));
					process.exit(1);
				}

				// Subscribe to agent output notifications
				subscriptionId = await client.subscribe('agent.output', { agentId });

				if (format === 'human') {
					formatter.message(`Tailing agent ${agentId} output (Ctrl+C to stop)...`, 'info');
				}

				// Handle incoming notifications
				unsubscribeHandler = client.onNotification((method, params) => {
					if (method !== 'agent.output') {
						return;
					}

					const notification = params as Record<string, unknown>;

					// Filter by agent ID
					if (notification.agentId !== agentId) {
						return;
					}

					const event = notification.event as Record<string, unknown> | undefined;
					if (!event) {
						return;
					}

					if (format === 'json') {
						// In JSON mode, output raw events
						console.log(JSON.stringify(event));
					} else if (format === 'quiet') {
						// In quiet mode, only output text content
						if (event.type === 'text' || event.type === 'content' || event.type === 'message') {
							console.log(event.content ?? event.text ?? '');
						}
					} else {
						// Human-readable format
						const formatted = formatOutputEvent(event, includeTypes, true);
						if (formatted !== null) {
							console.log(formatted);
						}
					}
				});

				// Keep the process running until interrupted
				await new Promise(() => {
					// This promise never resolves - we wait for SIGINT/SIGTERM
				});
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				await cleanup();
				process.exit(1);
			}
		});
}
