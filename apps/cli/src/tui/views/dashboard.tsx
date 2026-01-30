/**
 * Dashboard view - main overview of the system.
 * @module tui/views/dashboard
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { formatUptime } from '../../utils/time';
import { ActivityFeed } from '../components/activity-feed';
import { useAgents } from '../hooks/use-agents';
import { useChannels } from '../hooks/use-channels';
import { useDaemon } from '../hooks/use-daemon';

/**
 * Dashboard view showing system overview.
 */
export function Dashboard(): React.ReactElement {
	const { status, connected } = useDaemon({});
	const { agents } = useAgents();
	const { channels } = useChannels();

	const runningAgents = agents.filter((a) => a.status === 'running').length;
	const pausedAgents = agents.filter((a) => a.status === 'paused').length;
	const terminatedAgents = agents.filter((a) => a.status === 'terminated').length;

	const connectedChannels = channels.filter((c) => c.status === 'connected').length;
	const disconnectedChannels = channels.filter((c) => c.status === 'disconnected').length;
	const errorChannels = channels.filter((c) => c.status === 'error').length;

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					Dashboard
				</Text>
			</Box>

			<Box flexDirection="row" marginBottom={1}>
				{/* Daemon Status Panel */}
				<Box
					flexDirection="column"
					marginRight={4}
					borderStyle="round"
					borderColor="gray"
					padding={1}
					width={30}
				>
					<Text bold underline>
						Daemon Status
					</Text>
					<Box marginTop={1} flexDirection="column">
						<Box>
							<Box width={12}>
								<Text>Status:</Text>
							</Box>
							<Text color={connected && status?.running ? 'green' : 'red'}>
								{connected ? (status?.running ? 'Running' : 'Stopped') : 'Disconnected'}
							</Text>
						</Box>
						<Box>
							<Box width={12}>
								<Text>Version:</Text>
							</Box>
							<Text>{status?.version ?? 'Unknown'}</Text>
						</Box>
						<Box>
							<Box width={12}>
								<Text>Uptime:</Text>
							</Box>
							<Text>{status?.uptime ? formatUptime(status.uptime) : 'N/A'}</Text>
						</Box>
						<Box>
							<Box width={12}>
								<Text>PID:</Text>
							</Box>
							<Text>{status?.pid ?? 'N/A'}</Text>
						</Box>
					</Box>
				</Box>

				{/* Agents Panel */}
				<Box
					flexDirection="column"
					marginRight={4}
					borderStyle="round"
					borderColor="gray"
					padding={1}
					width={25}
				>
					<Text bold underline>
						Agents
					</Text>
					<Box marginTop={1} flexDirection="column">
						<Box>
							<Box width={14}>
								<Text>Running:</Text>
							</Box>
							<Text color="green">{runningAgents}</Text>
						</Box>
						<Box>
							<Box width={14}>
								<Text>Paused:</Text>
							</Box>
							<Text color="yellow">{pausedAgents}</Text>
						</Box>
						<Box>
							<Box width={14}>
								<Text>Terminated:</Text>
							</Box>
							<Text color="red">{terminatedAgents}</Text>
						</Box>
						<Box marginTop={1}>
							<Box width={14}>
								<Text bold>Total:</Text>
							</Box>
							<Text bold>{agents.length}</Text>
						</Box>
					</Box>
				</Box>

				{/* Channels Panel */}
				<Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1} width={25}>
					<Text bold underline>
						Channels
					</Text>
					<Box marginTop={1} flexDirection="column">
						<Box>
							<Box width={14}>
								<Text>Connected:</Text>
							</Box>
							<Text color="green">{connectedChannels}</Text>
						</Box>
						<Box>
							<Box width={14}>
								<Text>Disconnected:</Text>
							</Box>
							<Text color="gray">{disconnectedChannels}</Text>
						</Box>
						<Box>
							<Box width={14}>
								<Text>Error:</Text>
							</Box>
							<Text color="red">{errorChannels}</Text>
						</Box>
						<Box marginTop={1}>
							<Box width={14}>
								<Text bold>Total:</Text>
							</Box>
							<Text bold>{channels.length}</Text>
						</Box>
					</Box>
				</Box>
			</Box>

			{/* Activity Feed */}
			<Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
				<Box marginBottom={1}>
					<Text bold underline>
						Recent Activity
					</Text>
				</Box>
				<ActivityFeed limit={10} />
			</Box>
		</Box>
	);
}
