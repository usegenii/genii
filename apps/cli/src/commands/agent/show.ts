/**
 * Agent show command.
 * @module commands/agent/show
 */

import type { Command } from 'commander';
import { type AgentSnapshot, createDaemonClient } from '../../client';
import { getFormatter, getOutputFormat } from '../../output/formatter';
import { formatDuration, formatTimestamp } from '../../utils/time';

function parseTimestamp(value: string | number | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	const timestamp = new Date(value).getTime();
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

function formatOptionalTimestamp(value: string | number | undefined): string {
	const timestamp = parseTimestamp(value);
	return timestamp === undefined ? 'Unavailable' : formatTimestamp(timestamp);
}

function formatElapsedDuration(createdAt: string): string | undefined {
	const createdTimestamp = parseTimestamp(createdAt);
	if (createdTimestamp === undefined) {
		return undefined;
	}

	return formatDuration(Math.max(0, Date.now() - createdTimestamp));
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

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

				// Get agent details and preserve the existing JSON payload shape.
				const agentDetails = await client.getAgent(agentId);
				const elapsedDuration = formatElapsedDuration(agentDetails.createdAt) ?? 'Unavailable';

				if (format === 'json') {
					formatter.success({ ...agentDetails, duration: elapsedDuration });
					return;
				}
				if (format === 'quiet') {
					formatter.raw(agentDetails.id);
					return;
				}

				const snapshot = await client.getAgentSnapshot(agentId);
				const metrics: Partial<AgentSnapshot['metrics']> | undefined = snapshot.metrics;
				const duration = isNonNegativeFiniteNumber(metrics?.durationMs)
					? formatDuration(metrics.durationMs)
					: elapsedDuration;
				const pairs: Array<[string, unknown]> = [
					['Session ID', agentDetails.id],
					['Status', agentDetails.status],
				];

				if (agentDetails.guidancePath) {
					pairs.push(['Guidance Path', agentDetails.guidancePath]);
				}
				if (agentDetails.parentId) {
					pairs.push(['Parent Session', agentDetails.parentId]);
				}
				if (agentDetails.tags && agentDetails.tags.length > 0) {
					pairs.push(['Tags', agentDetails.tags.join(', ')]);
				}
				if (agentDetails.metadata && Object.keys(agentDetails.metadata).length > 0) {
					pairs.push(['Metadata', JSON.stringify(agentDetails.metadata)]);
				}

				pairs.push(['Created At', formatOptionalTimestamp(agentDetails.createdAt)]);
				pairs.push(['Snapshot At', formatOptionalTimestamp(snapshot.timestamp)]);
				pairs.push(['Duration', duration]);

				if (isNonNegativeFiniteNumber(metrics?.turns)) {
					pairs.push(['Turns', metrics.turns]);
				}
				if (isNonNegativeFiniteNumber(metrics?.toolCalls)) {
					pairs.push(['Tool Calls', metrics.toolCalls]);
				}

				const tokens = metrics?.tokensUsed;
				if (
					tokens &&
					isNonNegativeFiniteNumber(tokens.input) &&
					isNonNegativeFiniteNumber(tokens.output) &&
					isNonNegativeFiniteNumber(tokens.total)
				) {
					pairs.push(['Tokens', `${tokens.total} total (${tokens.input} input, ${tokens.output} output)`]);
				}

				formatter.keyValue(pairs);
			} catch (err) {
				formatter.error(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			} finally {
				await client.disconnect();
			}
		});
}
