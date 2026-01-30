/**
 * Agent list command and command group registration.
 * @module commands/agent/list
 */

import type { Command } from 'commander';
import { createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { formatDuration } from '../../utils/time';
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
const VALID_STATUSES = ['running', 'paused', 'waiting', 'completed', 'failed', 'terminated'] as const;

/**
 * Parse comma-separated status filter.
 */
function parseStatusFilter(statusStr: string | undefined): string[] | undefined {
	if (!statusStr) {
		return undefined;
	}
	const statuses = statusStr.split(',').map((s) => s.trim().toLowerCase());
	for (const status of statuses) {
		if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
			throw new Error(`Invalid status: ${status}. Valid statuses: ${VALID_STATUSES.join(', ')}`);
		}
	}
	return statuses;
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
		.option('--status <statuses>', 'Filter by status (running,paused,waiting,completed,failed,terminated)')
		.option('--channel <id>', 'Filter by bound channel')
		.action(async (options) => {
			const globalOpts = agent.parent?.opts() ?? {};
			const format = getOutputFormat(globalOpts);
			const formatter = getFormatter(format);

			const client = createDaemonClient();

			try {
				await client.connect();

				// Parse status filter
				let statusFilter: string[] | undefined;
				try {
					statusFilter = parseStatusFilter(options.status);
				} catch (err) {
					formatter.error(err instanceof Error ? err : new Error(String(err)));
					process.exit(1);
				}

				// Get agents list
				const agents = await client.listAgents({
					status: statusFilter?.[0] as 'running' | 'paused' | 'terminated' | 'all' | undefined,
					includeTerminated: statusFilter?.includes('terminated'),
				});

				// Filter by channel if specified
				let filteredAgents = agents;
				if (options.channel) {
					// Note: The filter by channel would need to be done client-side
					// as the current API doesn't support it directly
					filteredAgents = agents;
				}

				// Filter by multiple statuses if specified
				if (statusFilter && statusFilter.length > 1) {
					filteredAgents = filteredAgents.filter((a) => statusFilter.includes(a.status));
				}

				// Output based on format
				if (format === 'json') {
					formatter.success(filteredAgents);
				} else if (format === 'quiet') {
					// In quiet mode, just output IDs
					for (const a of filteredAgents) {
						formatter.raw(a.id);
					}
				} else {
					// Human-readable table
					formatter.table(filteredAgents, [
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
	terminateCommand(agent);
	pauseCommand(agent);
	resumeCommand(agent);
	sendCommand(agent);
	tailCommand(agent);
}
