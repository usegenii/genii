/**
 * Logs view - real-time log viewer.
 * @module tui/views/logs
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { createClient, type DaemonClient } from '../../client';
import { formatTimestamp } from '../../utils/time';
import { useKeyboard } from '../hooks/use-keyboard';

/**
 * Log entry structure.
 */
interface LogEntry {
	id: string;
	timestamp: string;
	level: 'debug' | 'info' | 'warn' | 'error';
	message: string;
	source?: string;
}

/**
 * Log level type.
 */
type LogLevel = LogEntry['level'] | 'all';

/**
 * Get color for log level.
 */
function getLevelColor(level: LogEntry['level']): string {
	switch (level) {
		case 'debug':
			return 'gray';
		case 'info':
			return 'blue';
		case 'warn':
			return 'yellow';
		case 'error':
			return 'red';
		default:
			return 'white';
	}
}

/**
 * Get level label for display.
 */
function getLevelLabel(level: LogEntry['level']): string {
	return level.toUpperCase().padEnd(5);
}

/**
 * Logs view showing real-time daemon logs.
 */
export function Logs(): React.ReactElement {
	const [client] = useState<DaemonClient>(() => createClient());
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [filter, setFilter] = useState<LogLevel>('all');
	const [autoFollow, setAutoFollow] = useState(true);
	const [connected, setConnected] = useState(false);
	const [scrollOffset, setScrollOffset] = useState(0);

	const maxVisibleLogs = 20;

	// Connect to daemon and subscribe to log events
	useEffect(() => {
		let unsubscribe: (() => void) | null = null;

		const connect = async () => {
			try {
				await client.connect();
				setConnected(true);

				// Subscribe to log notifications
				unsubscribe = client.onNotification((method, params) => {
					if (method === 'log' || method === 'daemon.log') {
						const logParams = params as {
							level?: string;
							message?: string;
							source?: string;
							timestamp?: string;
						};

						const level = (logParams.level ?? 'info') as LogEntry['level'];
						const newLog: LogEntry = {
							id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
							timestamp: logParams.timestamp ?? formatTimestamp(Date.now()),
							level,
							message: logParams.message ?? '',
							source: logParams.source,
						};

						setLogs((prev) => [...prev, newLog].slice(-500)); // Keep last 500 logs

						// Auto-scroll to bottom if following
						if (autoFollow) {
							setScrollOffset(0);
						}
					}
				});
			} catch {
				setConnected(false);
			}
		};

		void connect();

		return () => {
			unsubscribe?.();
			client.disconnect().catch(() => {});
		};
	}, [client, autoFollow]);

	// Handle keyboard shortcuts for log filtering and scrolling
	useKeyboard({
		onKey: (key) => {
			switch (key) {
				case '0':
					setFilter('all');
					break;
				case '1':
					setFilter('debug');
					break;
				case '2':
					setFilter('info');
					break;
				case '3':
					setFilter('warn');
					break;
				case '4':
					setFilter('error');
					break;
				case 'f':
					setAutoFollow((prev) => !prev);
					if (!autoFollow) {
						setScrollOffset(0);
					}
					break;
			}
		},
		onUp: () => {
			setAutoFollow(false);
			setScrollOffset((prev) => Math.min(prev + 1, Math.max(0, filteredLogs.length - maxVisibleLogs)));
		},
		onDown: () => {
			if (scrollOffset > 0) {
				setScrollOffset((prev) => Math.max(0, prev - 1));
			} else {
				setAutoFollow(true);
			}
		},
		enabled: true,
	});

	// Filter logs
	const filteredLogs = filter === 'all' ? logs : logs.filter((log) => log.level === filter);

	// Get visible logs based on scroll offset
	const visibleLogs = autoFollow
		? filteredLogs.slice(-maxVisibleLogs)
		: filteredLogs.slice(
				Math.max(0, filteredLogs.length - maxVisibleLogs - scrollOffset),
				filteredLogs.length - scrollOffset,
			);

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1} justifyContent="space-between">
				<Box>
					<Text bold color="cyan">
						Logs
					</Text>
					<Text color="gray">
						{' '}
						(filter: <Text color="yellow">{filter}</Text>)
					</Text>
				</Box>
				<Box>
					<Text color="gray">
						{connected ? <Text color="green">Streaming</Text> : <Text color="yellow">Connecting...</Text>}
						{' | '}
						Auto-follow: <Text color={autoFollow ? 'green' : 'gray'}>{autoFollow ? 'ON' : 'OFF'}</Text>
						{' | '}
						{filteredLogs.length} entries
					</Text>
				</Box>
			</Box>

			{/* Filter bar */}
			<Box marginBottom={1}>
				<Text color="gray">Filter: </Text>
				<Text color={filter === 'all' ? 'cyan' : 'gray'}>[0] All</Text>
				<Text> </Text>
				<Text color={filter === 'debug' ? 'cyan' : 'gray'}>[1] Debug</Text>
				<Text> </Text>
				<Text color={filter === 'info' ? 'cyan' : 'blue'}>[2] Info</Text>
				<Text> </Text>
				<Text color={filter === 'warn' ? 'cyan' : 'yellow'}>[3] Warn</Text>
				<Text> </Text>
				<Text color={filter === 'error' ? 'cyan' : 'red'}>[4] Error</Text>
			</Box>

			{/* Log entries */}
			<Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="gray" padding={1}>
				{visibleLogs.length === 0 ? (
					<Text color="gray">
						{connected
							? 'No logs to display. Logs will appear here in real-time.'
							: 'Connecting to daemon...'}
					</Text>
				) : (
					visibleLogs.map((log) => (
						<Box key={log.id}>
							<Text color="gray">{log.timestamp}</Text>
							<Text> </Text>
							<Text color={getLevelColor(log.level)}>[{getLevelLabel(log.level)}]</Text>
							<Text> </Text>
							{log.source && (
								<>
									<Text color="cyan">[{log.source}]</Text>
									<Text> </Text>
								</>
							)}
							<Text>{log.message}</Text>
						</Box>
					))
				)}
			</Box>

			<Box marginTop={1}>
				<Text color="gray">
					<Text color="yellow">0-4</Text> filter levels | <Text color="yellow">f</Text> toggle follow |{' '}
					<Text color="yellow">j/k</Text> scroll
				</Text>
			</Box>
		</Box>
	);
}
