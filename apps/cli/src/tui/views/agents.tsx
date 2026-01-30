/**
 * Agents view - list of all agents.
 * @module tui/views/agents
 */

import { Box, Text } from 'ink';
import React, { useState } from 'react';
import { AgentList } from '../components/agent-list';
import { useAgents } from '../hooks/use-agents';
import { useKeyboard } from '../hooks/use-keyboard';

/**
 * Props for the Agents view.
 */
export interface AgentsProps {
	/** Callback when an agent is selected */
	onSelect: (agentId: string) => void;
}

/**
 * Agents view showing all agents.
 */
export function Agents({ onSelect }: AgentsProps): React.ReactElement {
	const { agents, loading, error, pause, resume, terminate, refresh } = useAgents();
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

	// Clear status message after 3 seconds
	React.useEffect(() => {
		if (statusMessage) {
			const timeout = setTimeout(() => setStatusMessage(null), 3000);
			return () => clearTimeout(timeout);
		}
		return undefined;
	}, [statusMessage]);

	// Track which agent is selected for actions
	const _handleAgentHighlight = (agentId: string) => {
		setSelectedAgentId(agentId);
	};

	// Handle keyboard shortcuts for agent actions
	useKeyboard({
		onKey: async (key) => {
			if (!selectedAgentId) {
				return;
			}

			const agent = agents.find((a) => a.id === selectedAgentId);
			if (!agent) {
				return;
			}

			switch (key) {
				case 'p':
					if (agent.status === 'running') {
						const success = await pause(selectedAgentId);
						setStatusMessage(success ? `Paused agent ${agent.name ?? agent.id}` : 'Failed to pause agent');
					} else if (agent.status === 'paused') {
						const success = await resume(selectedAgentId);
						setStatusMessage(
							success ? `Resumed agent ${agent.name ?? agent.id}` : 'Failed to resume agent',
						);
					}
					break;
				case 'r':
					if (agent.status === 'paused') {
						const success = await resume(selectedAgentId);
						setStatusMessage(
							success ? `Resumed agent ${agent.name ?? agent.id}` : 'Failed to resume agent',
						);
					} else {
						await refresh();
						setStatusMessage('Refreshed agent list');
					}
					break;
				case 't':
					if (agent.status !== 'terminated') {
						const success = await terminate(selectedAgentId);
						setStatusMessage(
							success ? `Terminated agent ${agent.name ?? agent.id}` : 'Failed to terminate agent',
						);
					}
					break;
			}
		},
		enabled: true,
	});

	if (loading && agents.length === 0) {
		return (
			<Box padding={1}>
				<Text>Loading agents...</Text>
			</Box>
		);
	}

	if (error) {
		return (
			<Box padding={1}>
				<Text color="red">Error loading agents: {error}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					Agents ({agents.length})
				</Text>
				{statusMessage && (
					<Text color="gray">
						{' '}
						- <Text color="yellow">{statusMessage}</Text>
					</Text>
				)}
			</Box>

			{agents.length === 0 ? (
				<Box flexDirection="column">
					<Text color="gray">No agents running.</Text>
					<Text color="gray">Use 'genii agent spawn' to create one.</Text>
				</Box>
			) : (
				<AgentList
					agents={agents}
					onSelect={onSelect}
					onPause={(id) => {
						void pause(id);
					}}
					onResume={(id) => {
						void resume(id);
					}}
					onTerminate={(id) => {
						void terminate(id);
					}}
					enabled={true}
				/>
			)}

			<Box marginTop={1}>
				<Text color="gray">
					<Text color="yellow">Enter</Text> select | <Text color="yellow">p</Text> pause/resume |{' '}
					<Text color="yellow">t</Text> terminate | <Text color="yellow">r</Text> refresh
				</Text>
			</Box>
		</Box>
	);
}
