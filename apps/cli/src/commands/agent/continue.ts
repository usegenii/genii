/**
 * Agent continue command.
 * @module commands/agent/continue
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';

/**
 * Continue a previous agent session from a checkpoint.
 */
export function continueCommand(agent: Command): void {
	agent
		.command('continue <session-id> <message>')
		.description('Continue a previous agent session from checkpoint')
		.option('--model <model>', 'Override model (format: provider/model-name)')
		.action(async (sessionId: string, message: string, options) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				// Continue the agent session
				const result = await client.continueAgent(sessionId, message, options.model);

				// Output based on format
				if (format === 'json') {
					formatter.success(result);
				} else if (format === 'quiet') {
					// In quiet mode, just output the session ID
					formatter.raw(result.id);
				} else {
					// Human-readable output
					formatter.message(`Agent session continued`, 'success');
					const pairs: Array<[string, unknown]> = [
						['Session ID', result.id],
						['Continued From', sessionId],
					];
					if (options.model) {
						pairs.push(['Model Override', options.model]);
					}
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
