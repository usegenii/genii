/**
 * Agent terminate command.
 * @module commands/agent/terminate
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Terminate an agent.
 */
export function terminateCommand(agent: Command): void {
	agent
		.command('terminate <agent-id>')
		.alias('kill')
		.description('Terminate an agent')
		.option('--reason <text>', 'Reason for termination')
		.action(async (agentId: string, options) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				// Terminate the agent
				await client.terminateAgent(agentId, options.reason);

				// Output based on format
				if (format === 'json') {
					formatter.success({
						id: agentId,
						terminated: true,
						reason: options.reason,
					});
				} else if (format === 'quiet') {
					// In quiet mode, output nothing on success
				} else {
					// Human-readable output
					const message = options.reason
						? `Agent ${agentId} terminated: ${options.reason}`
						: `Agent ${agentId} terminated`;
					formatter.message(message, 'success');
				}
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
