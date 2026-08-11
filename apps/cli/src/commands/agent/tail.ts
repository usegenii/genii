/**
 * Agent tail command.
 * @module commands/agent/tail
 */

import type { AgentOutputRecord, RpcMethods } from '@genii/lib/rpc/methods';
import type { RpcNotificationParams } from '@genii/lib/rpc/notifications';
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
 * Format an arbitrary event value for display.
 */
function formatValue(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	return JSON.stringify(value, null, 2) ?? String(value);
}

/**
 * Format a tool call for display.
 */
function formatToolCall(toolName: string, input: unknown): string {
	return `${chalk.cyan(toolName)}(${chalk.gray(formatValue(input))})`;
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
	event: AgentOutputRecord['event'],
	includeTypes: Set<IncludeType>,
	showTimestamps: boolean,
): string | null {
	const timestamp = showTimestamps ? `${chalk.gray(formatTimestamp(event.timestamp))} ` : '';

	switch (event.type) {
		case 'output':
			return `${timestamp}${event.text}`;

		case 'thought':
			if (!includeTypes.has('thinking')) {
				return null;
			}
			return `${timestamp}${chalk.magenta('[thinking]')} ${formatThinking(event.content)}`;

		case 'tool_start':
			if (!includeTypes.has('tools')) {
				return null;
			}
			return `${timestamp}${chalk.yellow('[tool]')} ${formatToolCall(event.toolName, event.input)}`;

		case 'tool_progress':
			if (!includeTypes.has('tools')) {
				return null;
			}
			return `${timestamp}${chalk.yellow('[tool]')} ${chalk.cyan(event.toolName)}: ${event.progress.message ?? 'In progress'}`;

		case 'tool_end': {
			if (!includeTypes.has('tools')) {
				return null;
			}
			const result = event.error ? chalk.red(event.error) : chalk.gray(formatValue(event.output));
			return `${timestamp}${chalk.green('[result]')} ${chalk.cyan(event.toolName)}: ${result}`;
		}

		case 'error':
			return `${timestamp}${chalk.red('[error]')} ${event.error}`;

		case 'done':
			return `${timestamp}${chalk.blue('[done]')}`;

		case 'status':
			return `${timestamp}${chalk.blue('[status]')} ${event.status}`;

		case 'suspended':
			return `${timestamp}${chalk.yellow('[suspended]')} ${event.pendingRequests.length} pending request(s)`;

		default:
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
			let cleanupPromise: Promise<void> | null = null;
			let completed = false;
			let resolveCompletion: () => void = () => {};
			const completion = new Promise<void>((resolve) => {
				resolveCompletion = resolve;
			});
			const bufferedNotifications: RpcNotificationParams['agent.output'][] = [];
			let lastSequence = -1;
			let replaying = true;
			let signalHandler: (() => void) | null = null;

			const cleanup = (): Promise<void> => {
				if (cleanupPromise) {
					return cleanupPromise;
				}

				cleanupPromise = (async () => {
					if (signalHandler) {
						process.off('SIGINT', signalHandler);
						process.off('SIGTERM', signalHandler);
					}
					unsubscribeHandler?.();
					unsubscribeHandler = null;
					if (subscriptionId && client.connected) {
						try {
							await client.unsubscribe(subscriptionId);
						} catch {
							// The daemon may already have released a completed subscription.
						}
					}
					await client.disconnect();
				})();

				return cleanupPromise;
			};

			signalHandler = () => {
				void cleanup().finally(() => process.exit(0));
			};
			process.on('SIGINT', signalHandler);
			process.on('SIGTERM', signalHandler);

			const writeRecord = (record: AgentOutputRecord): void => {
				if (record.agentId !== agentId || record.sequence <= lastSequence) {
					return;
				}

				lastSequence = record.sequence;
				const { event } = record;

				if (format === 'json') {
					console.log(JSON.stringify(event));
				} else if (format === 'quiet') {
					if (event.type === 'output') {
						console.log(event.text);
					}
				} else {
					const formatted = formatOutputEvent(event, includeTypes, true);
					if (formatted !== null) {
						console.log(formatted);
					}
				}

				if ((event.type === 'done' || (event.type === 'error' && event.fatal)) && !completed) {
					completed = true;
					resolveCompletion();
				}
			};

			const writeOrderedRecords = (records: AgentOutputRecord[]): void => {
				for (const record of [...records].sort((left, right) => left.sequence - right.sequence)) {
					writeRecord(record);
				}
			};

			try {
				await client.connect();

				// First verify the agent exists
				try {
					await client.getAgent(agentId);
				} catch {
					formatter.error(new Error(`Agent not found: ${agentId}`));
					process.exit(1);
				}

				// Register before subscribing so notifications sent alongside the response are buffered.
				unsubscribeHandler = client.onNotification((notification) => {
					if (notification.method !== 'agent.output' || notification.params.agentId !== agentId) {
						return;
					}

					if (subscriptionId === null || replaying) {
						bufferedNotifications.push(notification.params);
						return;
					}

					if (notification.params.subscriptionId !== subscriptionId) {
						return;
					}
					writeRecord(notification.params);
				});

				const result = await client.subscribeAgentOutput({
					id: agentId as RpcMethods['subscribe.agent.output']['id'],
				});
				subscriptionId = result.subscriptionId;

				if (format === 'human') {
					formatter.message(`Tailing agent ${agentId} output (Ctrl+C to stop)...`, 'info');
				}

				const bufferedForSubscription = bufferedNotifications.filter(
					(notification) => notification.subscriptionId === subscriptionId,
				);
				bufferedNotifications.length = 0;
				writeOrderedRecords([...result.events, ...bufferedForSubscription]);
				replaying = false;

				if (!completed) {
					await completion;
				}
				await cleanup();
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				await cleanup();
				process.exit(1);
			}
		});
}
