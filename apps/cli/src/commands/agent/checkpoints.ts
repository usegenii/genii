/**
 * Agent checkpoints command.
 * @module commands/agent/checkpoints
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * List available session checkpoints.
 */
export function checkpointsCommand(agent: Command): void {
	agent
		.command('checkpoints')
		.alias('cp')
		.description('List available session checkpoints')
		.action(async () => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				// Get list of checkpoints
				const checkpoints = await client.listCheckpoints();

				// Output based on format
				if (format === 'json') {
					formatter.success(checkpoints);
				} else if (format === 'quiet') {
					// In quiet mode, just output IDs
					for (const id of checkpoints) {
						formatter.raw(id);
					}
				} else {
					// Human-readable output
					if (checkpoints.length === 0) {
						formatter.message('No checkpoints available', 'info');
					} else {
						formatter.message(`Found ${checkpoints.length} checkpoint(s)`, 'info');
						for (const id of checkpoints) {
							formatter.raw(`  ${id}`);
						}
					}
				}
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
