/**
 * Channels view - list of all communication channels.
 * @module tui/views/channels
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type Channel, ChannelList } from '../components/channel-list';
import { useChannels } from '../hooks/use-channels';
import { useKeyboard } from '../hooks/use-keyboard';

/**
 * Channels view showing all communication channels.
 */
export function Channels(): React.ReactElement {
	const { channels: rawChannels, loading, error, connect, disconnect, reconnect, refresh } = useChannels();
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

	// Transform ChannelSummary to Channel for the list component
	const channels: Channel[] = rawChannels.map((ch) => ({
		id: ch.id,
		name: ch.id, // Use ID as name since ChannelSummary doesn't have name
		type: ch.type,
		status: ch.status,
		messageCount: ch.conversationCount ?? 0,
	}));

	// Clear status message after 3 seconds
	useEffect(() => {
		if (statusMessage) {
			const timeout = setTimeout(() => setStatusMessage(null), 3000);
			return () => clearTimeout(timeout);
		}
		return undefined;
	}, [statusMessage]);

	// Track selected channel
	useEffect(() => {
		if (channels.length > 0 && !selectedChannelId) {
			setSelectedChannelId(channels[0]?.id ?? null);
		}
	}, [channels, selectedChannelId]);

	// Handle keyboard shortcuts
	useKeyboard({
		onKey: async (key) => {
			if (!selectedChannelId) {
				return;
			}

			const channel = channels.find((c) => c.id === selectedChannelId);
			if (!channel) {
				return;
			}

			switch (key) {
				case 'c':
					if (channel.status === 'disconnected' || channel.status === 'error') {
						const success = await connect(selectedChannelId);
						setStatusMessage(success ? `Connected channel ${channel.name}` : 'Failed to connect channel');
					}
					break;
				case 'd':
					if (channel.status === 'connected') {
						const success = await disconnect(selectedChannelId);
						setStatusMessage(
							success ? `Disconnected channel ${channel.name}` : 'Failed to disconnect channel',
						);
					}
					break;
				case 'r':
					if (channel.status === 'error' || channel.status === 'connected') {
						const success = await reconnect(selectedChannelId);
						setStatusMessage(
							success ? `Reconnected channel ${channel.name}` : 'Failed to reconnect channel',
						);
					} else {
						await refresh();
						setStatusMessage('Refreshed channel list');
					}
					break;
			}
		},
		enabled: true,
	});

	if (loading && channels.length === 0) {
		return (
			<Box padding={1}>
				<Text>Loading channels...</Text>
			</Box>
		);
	}

	if (error) {
		return (
			<Box padding={1}>
				<Text color="red">Error loading channels: {error}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					Channels ({channels.length})
				</Text>
				{statusMessage && (
					<Text color="gray">
						{' '}
						- <Text color="yellow">{statusMessage}</Text>
					</Text>
				)}
			</Box>

			{channels.length === 0 ? (
				<Box flexDirection="column">
					<Text color="gray">No channels configured.</Text>
					<Text color="gray">Configure channels in your genii config file.</Text>
				</Box>
			) : (
				<ChannelList
					channels={channels}
					onSelect={(id) => setSelectedChannelId(id)}
					onConnect={(id) => {
						void connect(id);
					}}
					onDisconnect={(id) => {
						void disconnect(id);
					}}
					onReconnect={(id) => {
						void reconnect(id);
					}}
					enabled={true}
				/>
			)}

			<Box marginTop={1}>
				<Text color="gray">
					<Text color="yellow">c</Text> connect | <Text color="yellow">d</Text> disconnect |{' '}
					<Text color="yellow">r</Text> reconnect/refresh
				</Text>
			</Box>
		</Box>
	);
}
