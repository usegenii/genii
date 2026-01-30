/**
 * Status bar component for the TUI.
 * @module tui/components/status-bar
 */

import { Box, Text } from 'ink';
import type React from 'react';
import type { View } from '../app';

/**
 * Props for the StatusBar component.
 */
export interface StatusBarProps {
	/** Whether connected to the daemon */
	connected: boolean;
	/** Current view being displayed */
	currentView: View;
	/** Optional extra status message */
	statusMessage?: string;
}

/**
 * View labels for display.
 */
const VIEW_LABELS: Record<View, string> = {
	dashboard: 'Dashboard',
	agents: 'Agents',
	'agent-detail': 'Agent Details',
	channels: 'Channels',
	logs: 'Logs',
};

/**
 * Status bar showing connection status and navigation hints.
 */
export function StatusBar({ connected, currentView, statusMessage }: StatusBarProps): React.ReactElement {
	const viewLabel = VIEW_LABELS[currentView] ?? currentView;

	return (
		<Box
			borderStyle="single"
			borderTop
			borderBottom={false}
			borderLeft={false}
			borderRight={false}
			paddingX={1}
			justifyContent="space-between"
		>
			<Box>
				<Text color="gray">
					<Text color={currentView === 'dashboard' ? 'cyan' : 'gray'}>[1]</Text> Dashboard{' '}
					<Text color={currentView === 'agents' || currentView === 'agent-detail' ? 'cyan' : 'gray'}>
						[2]
					</Text>{' '}
					Agents <Text color={currentView === 'channels' ? 'cyan' : 'gray'}>[3]</Text> Channels{' '}
					<Text color={currentView === 'logs' ? 'cyan' : 'gray'}>[4]</Text> Logs <Text color="gray">|</Text>{' '}
					<Text color="yellow">[?]</Text> Help <Text color="red">[q]</Text> Quit
				</Text>
			</Box>
			<Box>
				<Text>
					{statusMessage && (
						<>
							<Text color="gray">{statusMessage}</Text>
							<Text color="gray"> | </Text>
						</>
					)}
					<Text color={connected ? 'green' : 'red'}>{connected ? 'Connected' : 'Disconnected'}</Text>
					<Text color="gray"> | </Text>
					<Text bold>{viewLabel}</Text>
				</Text>
			</Box>
		</Box>
	);
}
