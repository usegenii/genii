/**
 * Agent spawn command.
 * @module commands/agent/spawn
 */

import type { RpcMethods } from '@genii/lib/rpc/methods';
import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { formatDuration, formatTimestamp } from '../../utils/time';

/**
 * Parse bind option in format channel:ref.
 */
type SpawnBind = NonNullable<RpcMethods['agent.spawn']['bind']>;

interface SpawnCommandOptions {
	task?: string;
	bind?: string;
	model?: string;
}

function parseBindOption(bind: string | undefined): SpawnBind | undefined {
	if (bind === undefined) {
		return undefined;
	}

	const separatorIndex = bind.indexOf(':');
	if (separatorIndex < 1 || separatorIndex === bind.length - 1) {
		throw new Error('Invalid bind format. Expected channel:ref');
	}

	const channelId = bind.slice(0, separatorIndex).trim();
	const ref = bind.slice(separatorIndex + 1);
	if (channelId.length === 0 || ref.trim().length === 0) {
		throw new Error('Invalid bind format. Channel and ref must both be non-empty');
	}

	return { channelId: channelId as SpawnBind['channelId'], ref };
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
		.option('--model <model>', 'Model to use for the agent')
		.action(async (instruction: string | undefined, options: SpawnCommandOptions) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			let bindInfo: SpawnBind | undefined;
			try {
				bindInfo = parseBindOption(options.bind);
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			}

			const spawnRequest: RpcMethods['agent.spawn'] = {
				...(options.model === undefined ? {} : { model: options.model }),
				...(options.task === undefined ? {} : { task: options.task }),
				...(bindInfo === undefined ? {} : { bind: bindInfo }),
				...(instruction === undefined ? {} : { input: { message: instruction } }),
			};
			const client = createDaemonClient();

			try {
				await client.connect();

				// Spawn the agent
				const result = await client.spawnAgent(spawnRequest);

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
