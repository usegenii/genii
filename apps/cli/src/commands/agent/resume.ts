/**
 * Agent resume command.
 * @module commands/agent/resume
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Resume a paused agent.
 */
export function resumeCommand(agent: Command): void {
	agent
		.command('resume <agent-id>')
		.description('Resume a paused agent')
		.action(async (agentId: string) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				// Resume the agent
				await client.resumeAgent(agentId);

				// Output based on format
				if (format === 'json') {
					formatter.success({
						id: agentId,
						resumed: true,
					});
				} else if (format === 'quiet') {
					// In quiet mode, output nothing on success
				} else {
					// Human-readable output
					formatter.message(`Agent ${agentId} resumed`, 'success');
				}
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
