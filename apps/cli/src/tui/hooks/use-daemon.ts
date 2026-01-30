/**
 * Hook for daemon connection and status.
 * @module tui/hooks/use-daemon
 */

import { useCallback, useEffect, useState } from 'react';
import { type DaemonStatus as ClientDaemonStatus, createClient, type DaemonClient } from '../../client';

/**
 * Daemon status information.
 */
export interface DaemonStatus {
	running: boolean;
	version?: string;
	uptime?: number;
	pid?: number;
}

/**
 * Options for the useDaemon hook.
 */
export interface UseDaemonOptions {
	/** Refresh interval in milliseconds */
	refreshInterval?: number;
	/** Auto-connect on mount */
	autoConnect?: boolean;
}

/**
 * Return value of the useDaemon hook.
 */
export interface UseDaemonResult {
	/** Whether connected to the daemon */
	connected: boolean;
	/** Daemon status information */
	status: DaemonStatus | null;
	/** Error message if connection failed */
	error: string | null;
	/** Reconnect to the daemon */
	reconnect: () => Promise<void>;
	/** The daemon client instance */
	client: DaemonClient;
}

/**
 * Hook for managing daemon connection and status.
 */
export function useDaemon(options: UseDaemonOptions = {}): UseDaemonResult {
	const { refreshInterval = 5000, autoConnect = true } = options;

	const [client] = useState(() => createClient());
	const [connected, setConnected] = useState(false);
	const [status, setStatus] = useState<DaemonStatus | null>(null);
	const [error, setError] = useState<string | null>(null);

	const checkConnection = useCallback(async () => {
		try {
			// First ensure we're connected
			if (!client.connected) {
				await client.connect();
			}

			// Ping to verify connection
			await client.ping();
			setConnected(true);
			setError(null);

			// Fetch full status
			const daemonStatus: ClientDaemonStatus = await client.status();
			setStatus({
				running: true,
				version: daemonStatus.version,
				uptime: daemonStatus.uptime,
				pid: daemonStatus.pid,
			});
		} catch (err) {
			setConnected(false);
			setStatus(null);
			setError(err instanceof Error ? err.message : 'Unknown error');
		}
	}, [client]);

	const reconnect = useCallback(async () => {
		setError(null);
		// Disconnect first if connected
		if (client.connected) {
			await client.disconnect();
		}
		await checkConnection();
	}, [client, checkConnection]);

	useEffect(() => {
		if (autoConnect) {
			void checkConnection();
		}
		return () => {
			client.disconnect().catch(() => {});
		};
	}, [autoConnect, checkConnection, client]);

	useEffect(() => {
		if (refreshInterval > 0 && connected) {
			const interval = setInterval(() => {
				void checkConnection();
			}, refreshInterval);
			return () => clearInterval(interval);
		}
		return undefined;
	}, [refreshInterval, checkConnection, connected]);

	return {
		connected,
		status,
		error,
		reconnect,
		client,
	};
}
