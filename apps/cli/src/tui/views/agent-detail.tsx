/**
 * Agent detail view - detailed information about a single agent.
 * @module tui/views/agent-detail
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { formatRelativeTime } from '../../utils/time';
import { useAgents } from '../hooks/use-agents';
import { useKeyboard } from '../hooks/use-keyboard';

/**
 * Props for the AgentDetail view.
 */
export interface AgentDetailProps {
	/** The ID of the agent to display */
	agentId: string | null;
	/** Callback to go back to agents list */
	onBack: () => void;
}

/**
 * Agent detail view showing comprehensive agent information.
 */
export function AgentDetail({ agentId, onBack }: AgentDetailProps): React.ReactElement {
	const { agents, pause, resume, terminate } = useAgents();
	const agent = agents.find((a) => a.id === agentId);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);

	// Clear status message after 3 seconds
	useEffect(() => {
		if (statusMessage) {
			const timeout = setTimeout(() => setStatusMessage(null), 3000);
			return () => clearTimeout(timeout);
		}
		return undefined;
	}, [statusMessage]);

	// Handle keyboard shortcuts
	useKeyboard({
		onEscape: onBack,
		onKey: async (key) => {
			if (!agent || !agentId) {
				return;
			}

			switch (key) {
				case 'b':
					onBack();
					break;
				case 'p':
					if (agent.status === 'running') {
						const success = await pause(agentId);
						setStatusMessage(success ? 'Agent paused' : 'Failed to pause agent');
					} else if (agent.status === 'paused') {
						const success = await resume(agentId);
						setStatusMessage(success ? 'Agent resumed' : 'Failed to resume agent');
					}
					break;
				case 'r':
					if (agent.status === 'paused') {
						const success = await resume(agentId);
						setStatusMessage(success ? 'Agent resumed' : 'Failed to resume agent');
					}
					break;
				case 't':
					if (agent.status !== 'terminated') {
						const success = await terminate(agentId);
						setStatusMessage(success ? 'Agent terminated' : 'Failed to terminate agent');
					}
					break;
			}
		},
		enabled: true,
	});

	if (!agentId) {
		return (
			<Box padding={1}>
				<Text color="red">No agent selected</Text>
			</Box>
		);
	}

	if (!agent) {
		return (
			<Box padding={1} flexDirection="column">
				<Text color="red">Agent not found: {agentId}</Text>
				<Box marginTop={1}>
					<Text color="gray">
						Press <Text color="yellow">b</Text> or <Text color="yellow">Esc</Text> to go back
					</Text>
				</Box>
			</Box>
		);
	}

	const getStatusColor = (status: string): string => {
		switch (status) {
			case 'running':
				return 'green';
			case 'paused':
				return 'yellow';
			case 'terminated':
				return 'red';
			default:
				return 'gray';
		}
	};

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					Agent: {agent.name ?? agent.id}
				</Text>
				{statusMessage && (
					<Text color="gray">
						{' '}
						- <Text color="yellow">{statusMessage}</Text>
					</Text>
				)}
			</Box>

			{/* Basic Info */}
			<Box flexDirection="row" marginBottom={1}>
				<Box
					flexDirection="column"
					marginRight={4}
					borderStyle="round"
					borderColor="gray"
					padding={1}
					width={40}
				>
					<Text bold underline>
						Basic Information
					</Text>
					<Box marginTop={1} flexDirection="column">
						<Box>
							<Box width={14}>
								<Text>ID:</Text>
							</Box>
							<Text>{agent.id}</Text>
						</Box>
						<Box>
							<Box width={14}>
								<Text>Name:</Text>
							</Box>
							<Text>{agent.name ?? '-'}</Text>
						</Box>
						<Box>
							<Box width={14}>
								<Text>Status:</Text>
							</Box>
							<Text color={getStatusColor(agent.status)}>{agent.status}</Text>
						</Box>
						<Box>
							<Box width={14}>
								<Text>Type:</Text>
							</Box>
							<Text>{agent.type ?? 'Unknown'}</Text>
						</Box>
						<Box>
							<Box width={14}>
								<Text>Created:</Text>
							</Box>
							<Text>{agent.createdAt ? formatRelativeTime(new Date(agent.createdAt)) : 'Unknown'}</Text>
						</Box>
					</Box>
				</Box>

				{/* Conversations */}
				<Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1} width={35}>
					<Text bold underline>
						Conversations
					</Text>
					<Box marginTop={1} flexDirection="column">
						<Box>
							<Box width={12}>
								<Text>Active:</Text>
							</Box>
							<Text color="green">{agent.conversations?.length ?? 0}</Text>
						</Box>
						{agent.conversations && agent.conversations.length > 0 && (
							<Box marginTop={1} flexDirection="column">
								<Text color="gray">Recent:</Text>
								{agent.conversations.slice(0, 3).map((conv) => (
									<Text key={conv} color="gray">
										{' '}
										- {conv.substring(0, 20)}...
									</Text>
								))}
								{agent.conversations.length > 3 && (
									<Text color="gray"> ...and {agent.conversations.length - 3} more</Text>
								)}
							</Box>
						)}
					</Box>
				</Box>
			</Box>

			{/* Actions */}
			<Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
				<Text bold underline>
					Available Actions
				</Text>
				<Box marginTop={1} flexDirection="row">
					{agent.status === 'running' && (
						<Box marginRight={2}>
							<Text color="yellow">[p]</Text>
							<Text> Pause</Text>
						</Box>
					)}
					{agent.status === 'paused' && (
						<Box marginRight={2}>
							<Text color="yellow">[r]</Text>
							<Text> Resume</Text>
						</Box>
					)}
					{agent.status !== 'terminated' && (
						<Box marginRight={2}>
							<Text color="yellow">[t]</Text>
							<Text color="red"> Terminate</Text>
						</Box>
					)}
					<Box>
						<Text color="yellow">[b/Esc]</Text>
						<Text> Back</Text>
					</Box>
				</Box>
			</Box>
		</Box>
	);
}
