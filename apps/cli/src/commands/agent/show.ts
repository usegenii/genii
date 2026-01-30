/**
 * Agent show command.
 * @module commands/agent/show
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { formatDuration, formatTimestamp } from '../../utils/time';

/**
 * Show details for a specific agent.
 */
export function showCommand(agent: Command): void {
	agent
		.command('show <agent-id>')
		.description('Show agent details')
		.action(async (agentId: string) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				// Get agent details
				const agentDetails = await client.getAgent(agentId);
				const snapshot = await client.getAgentSnapshot(agentId);

				// Calculate duration
				const created = new Date(agentDetails.createdAt).getTime();
				const duration = formatDuration(Date.now() - created);

				// Build full details object
				const fullDetails = {
					...agentDetails,
					duration,
					conversations: snapshot.conversations,
				};

				// Output based on format
				if (format === 'json') {
					formatter.success(fullDetails);
				} else if (format === 'quiet') {
					// In quiet mode, just output the ID
					formatter.raw(agentDetails.id);
				} else {
					// Human-readable key-value display
					const pairs: Array<[string, unknown]> = [
						['Session ID', agentDetails.id],
						['Status', agentDetails.status],
						['Model', agentDetails.model ?? 'default'],
					];

					// Configuration
					if (agentDetails.systemPrompt) {
						pairs.push(['System Prompt', `${agentDetails.systemPrompt.substring(0, 100)}...`]);
					}

					if (agentDetails.temperature !== undefined) {
						pairs.push(['Temperature', agentDetails.temperature]);
					}

					if (agentDetails.maxTokens !== undefined) {
						pairs.push(['Max Tokens', agentDetails.maxTokens]);
					}

					// Metadata
					if (agentDetails.metadata && Object.keys(agentDetails.metadata).length > 0) {
						pairs.push(['Metadata', JSON.stringify(agentDetails.metadata)]);
					}

					// Bound conversations
					if (snapshot.conversations && snapshot.conversations.length > 0) {
						const convInfo = snapshot.conversations
							.map((c) => `${c.channelId}:${c.ref} (${c.messageCount} msgs)`)
							.join(', ');
						pairs.push(['Bound Conversations', convInfo]);
					}

					// Timestamps
					pairs.push(['Created At', formatTimestamp(new Date(agentDetails.createdAt))]);
					pairs.push(['Last Active', formatTimestamp(new Date(agentDetails.lastActiveAt))]);
					pairs.push(['Duration', duration]);

					// Metrics
					pairs.push(['Conversations', agentDetails.conversationCount]);

					formatter.keyValue(pairs);
				}
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
