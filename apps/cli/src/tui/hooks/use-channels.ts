/**
 * Hook for channel management.
 * @module tui/hooks/use-channels
 */

import { useCallback, useEffect, useState } from 'react';
import { type ChannelSummary, createClient, type DaemonClient } from '../../client';

/**
 * Options for the useChannels hook.
 */
export interface UseChannelsOptions {
	/** Refresh interval in milliseconds */
	refreshInterval?: number;
}

/**
 * Return value of the useChannels hook.
 */
export interface UseChannelsResult {
	/** List of channels */
	channels: ChannelSummary[];
	/** Whether loading */
	loading: boolean;
	/** Error message if fetch failed */
	error: string | null;
	/** Refresh the channel list */
	refresh: () => Promise<void>;
	/** Connect a channel */
	connect: (channelId: string) => Promise<boolean>;
	/** Disconnect a channel */
	disconnect: (channelId: string) => Promise<boolean>;
	/** Reconnect a channel */
	reconnect: (channelId: string) => Promise<boolean>;
}

/**
 * Hook for managing channels.
 */
export function useChannels(options: UseChannelsOptions = {}): UseChannelsResult {
	const { refreshInterval = 5000 } = options;

	const [client] = useState<DaemonClient>(() => createClient());
	const [channels, setChannels] = useState<ChannelSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);

	// Connect to daemon on mount
	useEffect(() => {
		client
			.connect()
			.then(() => setConnected(true))
			.catch(() => setConnected(false));
		return () => {
			client.disconnect().catch(() => {});
		};
	}, [client]);

	const fetchChannels = useCallback(async () => {
		if (!connected) {
			return;
		}
		try {
			const channelList = await client.listChannels();
			setChannels(channelList);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unknown error');
		} finally {
			setLoading(false);
		}
	}, [client, connected]);

	const refresh = useCallback(async () => {
		setLoading(true);
		await fetchChannels();
	}, [fetchChannels]);

	const connect = useCallback(
		async (channelId: string): Promise<boolean> => {
			if (!connected) {
				setError('Not connected to daemon');
				return false;
			}
			try {
				await client.connectChannel(channelId);
				await fetchChannels();
				return true;
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Unknown error');
				return false;
			}
		},
		[client, fetchChannels, connected],
	);

	const disconnect = useCallback(
		async (channelId: string): Promise<boolean> => {
			if (!connected) {
				setError('Not connected to daemon');
				return false;
			}
			try {
				await client.disconnectChannel(channelId);
				await fetchChannels();
				return true;
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Unknown error');
				return false;
			}
		},
		[client, fetchChannels, connected],
	);

	const reconnect = useCallback(
		async (channelId: string): Promise<boolean> => {
			if (!connected) {
				setError('Not connected to daemon');
				return false;
			}
			try {
				await client.reconnectChannel(channelId);
				await fetchChannels();
				return true;
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Unknown error');
				return false;
			}
		},
		[client, fetchChannels, connected],
	);

	useEffect(() => {
		if (connected) {
			void fetchChannels();
		}
	}, [fetchChannels, connected]);

	useEffect(() => {
		if (refreshInterval > 0 && connected) {
			const interval = setInterval(() => {
				void fetchChannels();
			}, refreshInterval);
			return () => clearInterval(interval);
		}
		return undefined;
	}, [refreshInterval, fetchChannels, connected]);

	return {
		channels,
		loading,
		error,
		refresh,
		connect,
		disconnect,
		reconnect,
	};
}
