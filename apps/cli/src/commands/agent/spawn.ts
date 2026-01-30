/**
 * Agent spawn command.
 * @module commands/agent/spawn
 */

import type { Command } from 'commander';
import { createDaemonClient, type SpawnAgentOptions } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { formatDuration, formatTimestamp } from '../../utils/time';

/**
 * Parse bind option in format channel:ref.
 */
function parseBindOption(bind: string | undefined): { channelId: string; ref: string } | undefined {
	if (!bind) {
		return undefined;
	}
	const parts = bind.split(':');
	if (parts.length !== 2) {
		throw new Error('Invalid bind format. Expected channel:ref');
	}
	return { channelId: parts[0] ?? '', ref: parts[1] ?? '' };
}

/**
 * Spawn a new agent.
 */
export function spawnCommand(agent: Command): void {
	agent
		.command('spawn [instruction]')
		.description('Spawn a new agent with an optional initial instruction')
		.option('--task <id>', 'Task ID to start with')
		.option('--bind <channel:ref>', 'Bind to a specific conversation (channel:ref format)')
		.option('-n, --name <name>', 'Agent name')
		.option('--model <model>', 'Model to use for the agent')
		.option('--system-prompt <prompt>', 'System prompt for the agent')
		.action(async (instruction: string | undefined, options) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				// Parse bind option
				let bindInfo: { channelId: string; ref: string } | undefined;
				try {
					bindInfo = parseBindOption(options.bind);
				} catch (err) {
					formatter.error(err instanceof Error ? err : new Error(String(err)));
					process.exit(1);
				}

				// Build spawn options
				const spawnOptions: SpawnAgentOptions = {
					name: options.name,
					model: options.model,
					systemPrompt: options.systemPrompt,
					instruction,
					metadata: {},
				};

				// Add task metadata if specified
				if (options.task) {
					spawnOptions.metadata = {
						...spawnOptions.metadata,
						taskId: options.task,
					};
				}

				// Add bind metadata if specified
				if (bindInfo) {
					spawnOptions.metadata = {
						...spawnOptions.metadata,
						boundChannel: bindInfo.channelId,
						boundRef: bindInfo.ref,
					};
				}

				// Spawn the agent
				const result = await client.spawnAgent(spawnOptions);

				// Output based on format
				if (format === 'json') {
					formatter.success(result);
				} else if (format === 'quiet') {
					// In quiet mode, just output the new agent ID
					formatter.raw(result.id);
				} else {
					// Human-readable output - show agent details
					formatter.message(`Agent spawned successfully`, 'success');

					// Get full agent details to display
					const agentDetails = await client.getAgent(result.id);
					const created = new Date(agentDetails.createdAt).getTime();
					const duration = formatDuration(Date.now() - created);

					const pairs: Array<[string, unknown]> = [
						['ID', agentDetails.id],
						['Name', agentDetails.name],
						['Status', agentDetails.status],
						['Model', agentDetails.model ?? 'default'],
						['Created At', formatTimestamp(new Date(agentDetails.createdAt))],
						['Duration', duration],
					];

					if (bindInfo) {
						pairs.push(['Bound To', `${bindInfo.channelId}:${bindInfo.ref}`]);
					}

					if (options.task) {
						pairs.push(['Task', options.task]);
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
