/**
 * Human-readable output formatter with tables and colors.
 * @module output/human
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { formatRelativeTime } from '../utils/time';
import type { ColumnDef, Formatter, OutputData } from './formatter';

/**
 * Status colors for different states.
 */
const STATUS_COLORS = {
	running: chalk.green,
	connected: chalk.green,
	active: chalk.green,
	paused: chalk.yellow,
	disconnected: chalk.gray,
	terminated: chalk.red,
	error: chalk.red,
	closed: chalk.gray,
} as const;

/**
 * Format a status value with appropriate color.
 */
function formatStatus(status: string): string {
	const colorFn = STATUS_COLORS[status as keyof typeof STATUS_COLORS];
	return colorFn ? colorFn(status) : status;
}

/**
 * Format a date as relative time.
 */
function formatDate(value: unknown): string {
	if (value === null || value === undefined) {
		return chalk.gray('-');
	}
	const date = typeof value === 'string' ? new Date(value) : value;
	if (date instanceof Date && !Number.isNaN(date.getTime())) {
		return formatRelativeTime(date);
	}
	return String(value);
}

/**
 * Format memory usage in human-readable format.
 */
function formatBytes(bytes: number): string {
	const units = ['B', 'KB', 'MB', 'GB'];
	let unitIndex = 0;
	let value = bytes;

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}

	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Get value from an object by key path.
 */
function getValue(obj: unknown, key: string): unknown {
	if (typeof obj !== 'object' || obj === null) {
		return undefined;
	}

	const parts = key.split('.');
	let current: unknown = obj;

	for (const part of parts) {
		if (typeof current !== 'object' || current === null) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}

	return current;
}

/**
 * Human-readable formatter using chalk and cli-table3.
 */
export class HumanFormatter implements Formatter {
	success<T>(data: T): void {
		if (data === null || data === undefined) {
			console.log(`${chalk.green.bold('\u2713')} Success`);
			return;
		}

		if (typeof data === 'string') {
			console.log(`${chalk.green.bold('\u2713')} ${data}`);
			return;
		}

		if (typeof data === 'object') {
			console.log(JSON.stringify(data, null, 2));
		} else {
			console.log(String(data));
		}
	}

	error(error: Error | string): void {
		const message = error instanceof Error ? error.message : error;
		console.error(`${chalk.red.bold('\u2717')} ${chalk.red(message)}`);

		if (error instanceof Error && error.stack && process.env.DEBUG) {
			console.error(chalk.gray(error.stack));
		}
	}

	table<T>(data: T[], columns: ColumnDef[]): void {
		if (data.length === 0) {
			console.log(chalk.gray('No data to display'));
			return;
		}

		const table = new Table({
			head: columns.map((col) => chalk.bold(col.header)),
			style: {
				head: [],
				border: [],
			},
			colWidths: columns.map((col) => col.width ?? null),
			colAligns: columns.map((col) => col.align || 'left'),
		});

		for (const row of data) {
			const values = columns.map((col) => {
				const value = getValue(row, col.key);
				if (col.transform) {
					return col.transform(value, row);
				}
				return formatCellValue(value, col.key);
			});
			table.push(values);
		}

		console.log(table.toString());
	}

	list<T>(data: T[], transform: (item: T) => string): void {
		if (data.length === 0) {
			console.log(chalk.gray('No items'));
			return;
		}

		for (const item of data) {
			console.log(`  ${chalk.gray('\u2022')} ${transform(item)}`);
		}
	}

	keyValue(pairs: Array<[string, unknown]>): void {
		const maxKeyLength = Math.max(...pairs.map(([key]) => key.length));

		for (const [key, value] of pairs) {
			const paddedKey = key.padEnd(maxKeyLength);
			const formattedValue = formatKeyValueValue(value);
			console.log(`${chalk.bold(paddedKey)}  ${formattedValue}`);
		}
	}

	message(text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
		switch (type) {
			case 'success':
				console.log(`${chalk.green.bold('\u2713')} ${text}`);
				break;
			case 'warning':
				console.log(`${chalk.yellow.bold('\u26A0')} ${chalk.yellow(text)}`);
				break;
			case 'error':
				console.error(`${chalk.red.bold('\u2717')} ${chalk.red(text)}`);
				break;
			default:
				console.log(`${chalk.blue.bold('\u2139')} ${text}`);
		}
	}

	raw(value: unknown): void {
		if (value === null || value === undefined) {
			return;
		}
		console.log(String(value));
	}

	/**
	 * Format legacy OutputData structure.
	 */
	formatLegacy(data: OutputData): string {
		const { type, data: payload } = data;

		switch (type) {
			case 'agents':
				return this.formatAgentList(payload as unknown[]);
			case 'agent':
				return this.formatAgentDetail(payload);
			case 'channels':
				return this.formatChannelList(payload as unknown[]);
			case 'conversations':
				return this.formatConversationList(payload as unknown[]);
			case 'status':
				return this.formatStatus(payload);
			case 'error':
				return this.formatError(payload);
			default:
				return JSON.stringify(payload, null, 2);
		}
	}

	private formatAgentList(agents: unknown[]): string {
		if (agents.length === 0) {
			return chalk.gray('No agents running');
		}

		const table = new Table({
			head: [
				chalk.bold('ID'),
				chalk.bold('Name'),
				chalk.bold('Status'),
				chalk.bold('Convos'),
				chalk.bold('Last Active'),
			],
			style: { head: [], border: [] },
		});

		for (const agent of agents) {
			if (typeof agent === 'object' && agent !== null) {
				const a = agent as Record<string, unknown>;
				table.push([
					String(a.id ?? ''),
					String(a.name ?? ''),
					formatStatus(String(a.status ?? '')),
					String(a.conversationCount ?? 0),
					formatDate(a.lastActiveAt),
				]);
			}
		}

		return table.toString();
	}

	private formatAgentDetail(agent: unknown): string {
		if (typeof agent !== 'object' || agent === null) {
			return chalk.gray('No agent data');
		}

		const a = agent as Record<string, unknown>;
		const lines: string[] = [
			`${chalk.bold('ID:')}          ${a.id}`,
			`${chalk.bold('Name:')}        ${a.name}`,
			`${chalk.bold('Status:')}      ${formatStatus(String(a.status ?? ''))}`,
			`${chalk.bold('Model:')}       ${a.model ?? chalk.gray('default')}`,
			`${chalk.bold('Created:')}     ${formatDate(a.createdAt)}`,
			`${chalk.bold('Last Active:')} ${formatDate(a.lastActiveAt)}`,
		];

		if (a.conversationCount !== undefined) {
			lines.push(`${chalk.bold('Conversations:')} ${a.conversationCount}`);
		}

		if (a.systemPrompt) {
			lines.push('', chalk.bold('System Prompt:'));
			lines.push(chalk.gray(String(a.systemPrompt).substring(0, 200)));
		}

		return lines.join('\n');
	}

	private formatChannelList(channels: unknown[]): string {
		if (channels.length === 0) {
			return chalk.gray('No channels configured');
		}

		const table = new Table({
			head: [
				chalk.bold('ID'),
				chalk.bold('Type'),
				chalk.bold('Status'),
				chalk.bold('Convos'),
				chalk.bold('Last Message'),
			],
			style: { head: [], border: [] },
		});

		for (const channel of channels) {
			if (typeof channel === 'object' && channel !== null) {
				const c = channel as Record<string, unknown>;
				table.push([
					String(c.id ?? ''),
					String(c.type ?? ''),
					formatStatus(String(c.status ?? '')),
					String(c.conversationCount ?? 0),
					formatDate(c.lastMessageAt),
				]);
			}
		}

		return table.toString();
	}

	private formatConversationList(conversations: unknown[]): string {
		if (conversations.length === 0) {
			return chalk.gray('No active conversations');
		}

		const table = new Table({
			head: [
				chalk.bold('Ref'),
				chalk.bold('Channel'),
				chalk.bold('Agent'),
				chalk.bold('Messages'),
				chalk.bold('Last Message'),
			],
			style: { head: [], border: [] },
		});

		for (const conv of conversations) {
			if (typeof conv === 'object' && conv !== null) {
				const c = conv as Record<string, unknown>;
				table.push([
					String(c.ref ?? ''),
					String(c.channelId ?? ''),
					String(c.agentId ?? chalk.gray('-')),
					String(c.messageCount ?? 0),
					formatDate(c.lastMessageAt),
				]);
			}
		}

		return table.toString();
	}

	private formatStatus(status: unknown): string {
		if (typeof status !== 'object' || status === null) {
			return chalk.gray('Unknown status');
		}

		const s = status as Record<string, unknown>;
		const lines: string[] = [
			chalk.bold.green('Daemon Status'),
			'',
			`${chalk.bold('Version:')}       ${s.version ?? 'unknown'}`,
			`${chalk.bold('PID:')}           ${s.pid ?? 'unknown'}`,
			`${chalk.bold('Uptime:')}        ${formatUptime(s.uptime as number)}`,
			`${chalk.bold('Agents:')}        ${s.agentCount ?? 0}`,
			`${chalk.bold('Channels:')}      ${s.channelCount ?? 0}`,
			`${chalk.bold('Conversations:')} ${s.conversationCount ?? 0}`,
		];

		if (typeof s.memoryUsage === 'object' && s.memoryUsage !== null) {
			const mem = s.memoryUsage as Record<string, number>;
			lines.push('', chalk.bold('Memory:'));
			lines.push(`  Heap Used:  ${formatBytes(mem.heapUsed ?? 0)}`);
			lines.push(`  Heap Total: ${formatBytes(mem.heapTotal ?? 0)}`);
			lines.push(`  RSS:        ${formatBytes(mem.rss ?? 0)}`);
		}

		return lines.join('\n');
	}

	private formatError(error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		return `${chalk.red.bold('\u2717')} ${chalk.red(message)}`;
	}
}

/**
 * Format uptime in human-readable format.
 */
function formatUptime(seconds: number | undefined): string {
	if (seconds === undefined || seconds === null) {
		return chalk.gray('-');
	}

	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

	return parts.join(' ');
}

/**
 * Format a cell value for table display.
 */
function formatCellValue(value: unknown, key: string): string {
	if (value === null || value === undefined) {
		return chalk.gray('-');
	}

	// Handle status-like fields
	if (key === 'status' || key.endsWith('Status')) {
		return formatStatus(String(value));
	}

	// Handle date-like fields
	if (key.endsWith('At') || key.endsWith('Date') || key.endsWith('Time')) {
		return formatDate(value);
	}

	// Handle boolean values
	if (typeof value === 'boolean') {
		return value ? chalk.green('yes') : chalk.gray('no');
	}

	// Handle numbers
	if (typeof value === 'number') {
		return String(value);
	}

	return String(value);
}

/**
 * Format a value for key-value display.
 */
function formatKeyValueValue(value: unknown): string {
	if (value === null || value === undefined) {
		return chalk.gray('-');
	}

	if (typeof value === 'boolean') {
		return value ? chalk.green('yes') : chalk.gray('no');
	}

	if (typeof value === 'number') {
		return chalk.cyan(String(value));
	}

	if (value instanceof Date) {
		return formatRelativeTime(value);
	}

	if (typeof value === 'object') {
		return chalk.gray(JSON.stringify(value));
	}

	return String(value);
}

// Legacy export for backwards compatibility
export function formatHuman(data: OutputData): string {
	const formatter = new HumanFormatter();
	return formatter.formatLegacy(data);
}
