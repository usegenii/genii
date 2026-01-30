/**
 * Channel list component for the TUI.
 * @module tui/components/channel-list
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useListNavigation } from '../hooks/use-keyboard';

/**
 * Channel data structure.
 */
export interface Channel {
	id: string;
	name: string;
	type: string;
	status: 'connected' | 'disconnected' | 'error';
	messageCount: number;
}

/**
 * Props for the ChannelList component.
 */
export interface ChannelListProps {
	/** List of channels to display */
	channels: Channel[];
	/** Callback when a channel is selected */
	onSelect?: (channelId: string) => void;
	/** Callback when connect is pressed */
	onConnect?: (channelId: string) => void;
	/** Callback when disconnect is pressed */
	onDisconnect?: (channelId: string) => void;
	/** Callback when reconnect is pressed */
	onReconnect?: (channelId: string) => void;
	/** Whether keyboard navigation is enabled */
	enabled?: boolean;
}

/**
 * Get status color for channel.
 */
function getStatusColor(status: Channel['status']): string {
	switch (status) {
		case 'connected':
			return 'green';
		case 'disconnected':
			return 'gray';
		case 'error':
			return 'red';
		default:
			return 'gray';
	}
}

/**
 * Get status symbol for channel.
 */
function getStatusSymbol(status: Channel['status']): string {
	switch (status) {
		case 'connected':
			return '*';
		case 'disconnected':
			return 'o';
		case 'error':
			return '!';
		default:
			return '?';
	}
}

/**
 * Channel list component displaying channels in a table-like format.
 */
export function ChannelList({
	channels,
	onSelect,
	onConnect: _onConnect,
	onDisconnect: _onDisconnect,
	onReconnect: _onReconnect,
	enabled = true,
}: ChannelListProps): React.ReactElement {
	const { selectedIndex } = useListNavigation({
		itemCount: channels.length,
		onSelect: (index) => {
			const channel = channels[index];
			if (channel && onSelect) {
				onSelect(channel.id);
			}
		},
		enabled,
	});

	return (
		<Box flexDirection="column">
			{/* Header */}
			<Box>
				<Box width={3}>
					<Text bold> </Text>
				</Box>
				<Box width={20}>
					<Text bold>ID</Text>
				</Box>
				<Box width={20}>
					<Text bold>Name</Text>
				</Box>
				<Box width={15}>
					<Text bold>Type</Text>
				</Box>
				<Box width={14}>
					<Text bold>Status</Text>
				</Box>
				<Box width={10}>
					<Text bold>Messages</Text>
				</Box>
			</Box>

			{/* Rows */}
			{channels.map((channel, index) => {
				const isSelected = index === selectedIndex;
				const statusColor = getStatusColor(channel.status);
				return (
					<Box key={channel.id}>
						<Box width={3}>
							<Text color="cyan">{isSelected ? '>' : ' '}</Text>
						</Box>
						<Box width={20}>
							<Text inverse={isSelected} color={isSelected ? 'white' : undefined}>
								{channel.id.substring(0, 18)}
							</Text>
						</Box>
						<Box width={20}>
							<Text inverse={isSelected}>{channel.name}</Text>
						</Box>
						<Box width={15}>
							<Text inverse={isSelected}>{channel.type}</Text>
						</Box>
						<Box width={14}>
							<Text color={statusColor} inverse={isSelected}>
								[{getStatusSymbol(channel.status)}] {channel.status}
							</Text>
						</Box>
						<Box width={10}>
							<Text inverse={isSelected}>{channel.messageCount}</Text>
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}
