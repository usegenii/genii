/**
 * Hook for agent management.
 * @module tui/hooks/use-agents
 */

import { useCallback, useEffect, useState } from 'react';
import { createClient, type DaemonClient, type SpawnAgentOptions } from '../../client';
import type { Agent } from '../components/agent-list';

/**
 * Options for the useAgents hook.
 */
export interface UseAgentsOptions {
	/** Refresh interval in milliseconds */
	refreshInterval?: number;
	/** Filter by status */
	statusFilter?: Agent['status'] | 'all';
}

/**
 * Return value of the useAgents hook.
 */
export interface UseAgentsResult {
	/** List of agents */
	agents: Agent[];
	/** Whether loading */
	loading: boolean;
	/** Error message if fetch failed */
	error: string | null;
	/** Refresh the agent list */
	refresh: () => Promise<void>;
	/** Spawn a new agent */
	spawn: (config: SpawnAgentOptions) => Promise<string | null>;
	/** Terminate an agent */
	terminate: (agentId: string) => Promise<boolean>;
	/** Pause an agent */
	pause: (agentId: string) => Promise<boolean>;
	/** Resume an agent */
	resume: (agentId: string) => Promise<boolean>;
}

/**
 * Hook for managing agents.
 */
export function useAgents(options: UseAgentsOptions = {}): UseAgentsResult {
	const { refreshInterval = 5000, statusFilter = 'all' } = options;

	const [client] = useState<DaemonClient>(() => createClient());
	const [agents, setAgents] = useState<Agent[]>([]);
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

	const fetchAgents = useCallback(async () => {
		if (!connected) {
			return;
		}
		try {
			const agentList = await client.listAgents();
			let filteredList = agentList as Agent[];
			if (statusFilter !== 'all') {
				filteredList = filteredList.filter((a) => a.status === statusFilter);
			}
			setAgents(filteredList);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unknown error');
		} finally {
			setLoading(false);
		}
	}, [client, statusFilter, connected]);

	const refresh = useCallback(async () => {
		setLoading(true);
		await fetchAgents();
	}, [fetchAgents]);

	const spawn = useCallback(
		async (config: SpawnAgentOptions): Promise<string | null> => {
			if (!connected) {
				setError('Not connected to daemon');
				return null;
			}
			try {
				const result = await client.spawnAgent(config);
				await fetchAgents();
				return result.id;
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Unknown error');
				return null;
			}
		},
		[client, fetchAgents, connected],
	);

	const terminate = useCallback(
		async (agentId: string): Promise<boolean> => {
			if (!connected) {
				setError('Not connected to daemon');
				return false;
			}
			try {
				await client.terminateAgent(agentId);
				await fetchAgents();
				return true;
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Unknown error');
				return false;
			}
		},
		[client, fetchAgents, connected],
	);

	const pause = useCallback(
		async (agentId: string): Promise<boolean> => {
			if (!connected) {
				setError('Not connected to daemon');
				return false;
			}
			try {
				await client.pauseAgent(agentId);
				await fetchAgents();
				return true;
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Unknown error');
				return false;
			}
		},
		[client, fetchAgents, connected],
	);

	const resume = useCallback(
		async (agentId: string): Promise<boolean> => {
			if (!connected) {
				setError('Not connected to daemon');
				return false;
			}
			try {
				await client.resumeAgent(agentId);
				await fetchAgents();
				return true;
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Unknown error');
				return false;
			}
		},
		[client, fetchAgents, connected],
	);

	useEffect(() => {
		if (connected) {
			void fetchAgents();
		}
	}, [fetchAgents, connected]);

	useEffect(() => {
		if (refreshInterval > 0 && connected) {
			const interval = setInterval(() => {
				void fetchAgents();
			}, refreshInterval);
			return () => clearInterval(interval);
		}
		return undefined;
	}, [refreshInterval, fetchAgents, connected]);

	return {
		agents,
		loading,
		error,
		refresh,
		spawn,
		terminate,
		pause,
		resume,
	};
}
