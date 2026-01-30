/**
 * Help modal component for the TUI.
 * @module tui/components/help-modal
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useKeyboard } from '../hooks/use-keyboard';

/**
 * Props for the HelpModal component.
 */
export interface HelpModalProps {
	/** Callback when modal is closed */
	onClose: () => void;
}

/**
 * Keyboard shortcut definition.
 */
interface Shortcut {
	key: string;
	description: string;
}

/**
 * Help modal showing keyboard shortcuts.
 */
export function HelpModal({ onClose }: HelpModalProps): React.ReactElement {
	// Handle escape and ? to close
	useKeyboard({
		onEscape: onClose,
		onHelp: onClose,
		enabled: true,
	});

	const globalShortcuts: Shortcut[] = [
		{ key: 'q', description: 'Quit application' },
		{ key: '?', description: 'Toggle help' },
		{ key: '1', description: 'Go to Dashboard' },
		{ key: '2', description: 'Go to Agents' },
		{ key: '3', description: 'Go to Channels' },
		{ key: '4', description: 'Go to Logs' },
		{ key: 'Esc', description: 'Close modal / Go back' },
	];

	const navigationShortcuts: Shortcut[] = [
		{ key: 'j / Down', description: 'Move down' },
		{ key: 'k / Up', description: 'Move up' },
		{ key: 'Enter', description: 'Select item' },
	];

	const agentShortcuts: Shortcut[] = [
		{ key: 'Enter', description: 'View agent details' },
		{ key: 's', description: 'Spawn new agent' },
		{ key: 't', description: 'Terminate selected agent' },
		{ key: 'p', description: 'Pause agent' },
		{ key: 'r', description: 'Resume agent' },
	];

	const channelShortcuts: Shortcut[] = [
		{ key: 'c', description: 'Connect channel' },
		{ key: 'd', description: 'Disconnect channel' },
		{ key: 'r', description: 'Reconnect channel' },
	];

	const logShortcuts: Shortcut[] = [
		{ key: '0', description: 'Show all logs' },
		{ key: '1', description: 'Filter: debug' },
		{ key: '2', description: 'Filter: info' },
		{ key: '3', description: 'Filter: warn' },
		{ key: '4', description: 'Filter: error' },
		{ key: 'f', description: 'Toggle auto-follow' },
	];

	const renderShortcutSection = (title: string, shortcuts: Shortcut[]) => (
		<Box flexDirection="column" marginBottom={1}>
			<Text bold underline>
				{title}
			</Text>
			{shortcuts.map((shortcut) => (
				<Box key={shortcut.key}>
					<Box width={12}>
						<Text color="yellow">{shortcut.key}</Text>
					</Box>
					<Text>{shortcut.description}</Text>
				</Box>
			))}
		</Box>
	);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="blue"
			padding={1}
			position="absolute"
			marginLeft={5}
			marginTop={2}
		>
			<Box marginBottom={1}>
				<Text bold color="blue">
					Keyboard Shortcuts
				</Text>
			</Box>

			<Box flexDirection="row">
				<Box flexDirection="column" marginRight={4}>
					{renderShortcutSection('Global', globalShortcuts)}
					{renderShortcutSection('Navigation', navigationShortcuts)}
				</Box>

				<Box flexDirection="column" marginRight={4}>
					{renderShortcutSection('Agents View', agentShortcuts)}
					{renderShortcutSection('Channels View', channelShortcuts)}
				</Box>

				<Box flexDirection="column">{renderShortcutSection('Logs View', logShortcuts)}</Box>
			</Box>

			<Box marginTop={1}>
				<Text color="gray">Press ? or Esc to close</Text>
			</Box>
		</Box>
	);
}
