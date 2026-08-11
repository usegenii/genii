/**
 * Agent list command and command group registration.
 * @module commands/agent/list
 */

import type { AgentListFilter, RpcMethods } from '@genii/lib/rpc/methods';
import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { formatDuration } from '../../utils/time';
import { checkpointsCommand } from './checkpoints';
import { continueCommand } from './continue';
import { pauseCommand } from './pause';
import { resumeCommand } from './resume';
import { sendCommand } from './send';
import { showCommand } from './show';
import { spawnCommand } from './spawn';
import { tailCommand } from './tail';
import { terminateCommand } from './terminate';

/**
 * Valid agent statuses for filtering.
 */
const VALID_STATUSES = [
	'initializing',
	'running',
	'waiting',
	'paused',
	'completing',
	'completed',
	'failed',
	'terminated',
] as const;

type AgentStatus = (typeof VALID_STATUSES)[number];

interface ListCommandOptions {
	status?: string;
	channel?: string;
}

/**
 * Parse comma-separated status filter.
 */
function parseStatusFilter(statusStr: string | undefined): AgentStatus[] | undefined {
	if (statusStr === undefined) {
		return undefined;
	}
	if (statusStr.trim().length === 0) {
		throw new Error('Invalid status: status cannot be empty');
	}
	const statuses = statusStr.split(',').map((s) => s.trim().toLowerCase());
	for (const status of statuses) {
		if (!VALID_STATUSES.includes(status as AgentStatus)) {
			throw new Error(`Invalid status: ${status}. Valid statuses: ${VALID_STATUSES.join(', ')}`);
		}
	}
	return statuses as AgentStatus[];
}

/**
 * Parse and validate a channel ID.
 */
function parseChannelFilter(channel: string | undefined): AgentListFilter['channelId'] {
	if (channel === undefined) {
		return undefined;
	}

	const channelId = channel.trim();
	if (channelId.length === 0) {
		throw new Error('Invalid channel: channel ID cannot be empty');
	}

	return channelId as NonNullable<AgentListFilter['channelId']>;
}

/**
 * Calculate duration from createdAt timestamp.
 */
function calculateDuration(createdAt: string): string {
	const created = new Date(createdAt).getTime();
	const now = Date.now();
	return formatDuration(now - created);
}

/**
 * List all agents.
 */
export function listCommand(agent: Command): void {
	agent
		.command('list')
		.alias('ls')
		.description('List all agents')
		.option('--status <statuses>', 'Filter by comma-separated statuses (matches any status)')
		.option('--channel <id>', 'Filter by bound channel')
		.action(async (options: ListCommandOptions) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			let statusFilter: AgentStatus[] | undefined;
			let channelId: AgentListFilter['channelId'];
			try {
				statusFilter = parseStatusFilter(options.status);
				channelId = parseChannelFilter(options.channel);
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			}

			const filter: AgentListFilter = {};
			if (statusFilter !== undefined) {
				filter.status = statusFilter;
			}
			if (channelId !== undefined) {
				filter.channelId = channelId;
			}
			const request: RpcMethods['agent.list'] =
				statusFilter === undefined && channelId === undefined ? {} : { filter };
			const client = createDaemonClient();

			try {
				await client.connect();

				// Get agents list
				const agents = await client.listAgents(request);

				// Output based on format
				if (format === 'json') {
					formatter.success(agents);
				} else if (format === 'quiet') {
					// In quiet mode, just output IDs
					for (const a of agents) {
						formatter.raw(a.id);
					}
				} else {
					// Human-readable table
					formatter.table(agents, [
						{ header: 'ID', key: 'id', width: 12 },
						{ header: 'Status', key: 'status', width: 12 },
						{ header: 'Channel', key: 'conversationCount', width: 10 },
						{
							header: 'Created',
							key: 'createdAt',
							width: 16,
						},
						{
							header: 'Duration',
							key: 'createdAt',
							width: 12,
							transform: (value) => calculateDuration(String(value)),
						},
					]);
				}
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}

/**
 * Register all agent-related commands under the 'agent' command group.
 */
export function registerAgentCommands(program: Command): void {
	const agent = program.command('agent').alias('a').description('Manage agents');

	listCommand(agent);
	showCommand(agent);
	spawnCommand(agent);
	continueCommand(agent);
	checkpointsCommand(agent);
	terminateCommand(agent);
	pauseCommand(agent);
	resumeCommand(agent);
	sendCommand(agent);
	tailCommand(agent);
}
