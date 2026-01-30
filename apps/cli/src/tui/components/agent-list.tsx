/**
 * Agent list component for the TUI.
 * @module tui/components/agent-list
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useListNavigation } from '../hooks/use-keyboard';

/**
 * Agent data structure.
 */
export interface Agent {
	id: string;
	name?: string;
	status: 'running' | 'paused' | 'terminated';
	type?: string;
	createdAt?: string;
	conversations?: string[];
}

/**
 * Props for the AgentList component.
 */
export interface AgentListProps {
	/** List of agents to display */
	agents: Agent[];
	/** Callback when an agent is selected */
	onSelect?: (agentId: string) => void;
	/** Callback when pause is pressed on an agent */
	onPause?: (agentId: string) => void;
	/** Callback when resume is pressed on an agent */
	onResume?: (agentId: string) => void;
	/** Callback when terminate is pressed on an agent */
	onTerminate?: (agentId: string) => void;
	/** Whether keyboard navigation is enabled */
	enabled?: boolean;
}

/**
 * Get status color.
 */
function getStatusColor(status: Agent['status']): string {
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
}

/**
 * Agent list component displaying agents in a table-like format.
 */
export function AgentList({
	agents,
	onSelect,
	onPause: _onPause,
	onResume: _onResume,
	onTerminate: _onTerminate,
	enabled = true,
}: AgentListProps): React.ReactElement {
	const { selectedIndex } = useListNavigation({
		itemCount: agents.length,
		onSelect: (index) => {
			const agent = agents[index];
			if (agent && onSelect) {
				onSelect(agent.id);
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
				<Box width={12}>
					<Text bold>Status</Text>
				</Box>
				<Box width={15}>
					<Text bold>Type</Text>
				</Box>
			</Box>

			{/* Rows */}
			{agents.map((agent, index) => {
				const isSelected = index === selectedIndex;
				return (
					<Box key={agent.id}>
						<Box width={3}>
							<Text color="cyan">{isSelected ? '>' : ' '}</Text>
						</Box>
						<Box width={20}>
							<Text inverse={isSelected} color={isSelected ? 'white' : undefined}>
								{agent.id.substring(0, 18)}
							</Text>
						</Box>
						<Box width={20}>
							<Text inverse={isSelected}>{agent.name ?? '-'}</Text>
						</Box>
						<Box width={12}>
							<Text color={getStatusColor(agent.status)} inverse={isSelected}>
								{agent.status}
							</Text>
						</Box>
						<Box width={15}>
							<Text inverse={isSelected}>{agent.type ?? '-'}</Text>
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}
