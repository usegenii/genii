/**
 * Agent pause command.
 * @module commands/agent/pause
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Pause an agent.
 */
export function pauseCommand(agent: Command): void {
	agent
		.command('pause <agent-id>')
		.description('Pause an agent')
		.action(async (agentId: string) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				// Pause the agent
				await client.pauseAgent(agentId);

				// Output based on format
				if (format === 'json') {
					formatter.success({
						id: agentId,
						paused: true,
					});
				} else if (format === 'quiet') {
					// In quiet mode, output nothing on success
				} else {
					// Human-readable output
					formatter.message(`Agent ${agentId} paused`, 'success');
				}
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
