/**
 * Activity feed component for the TUI.
 * @module tui/components/activity-feed
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { createClient, type DaemonClient } from '../../client';
import { formatRelativeTime } from '../../utils/time';

/**
 * Activity event structure.
 */
export interface ActivityEvent {
	id: string;
	timestamp: Date;
	type: 'agent_spawned' | 'agent_terminated' | 'message_received' | 'message_sent' | 'channel_connected' | 'error';
	message: string;
	details?: Record<string, unknown>;
}

/**
 * Props for the ActivityFeed component.
 */
export interface ActivityFeedProps {
	/** Maximum number of events to display */
	limit?: number;
	/** Events to display (if provided, uses these instead of fetching) */
	events?: ActivityEvent[];
}

/**
 * Get icon/indicator for activity type.
 */
function getActivityIndicator(type: ActivityEvent['type']): { symbol: string; color: string } {
	switch (type) {
		case 'agent_spawned':
			return { symbol: '+', color: 'green' };
		case 'agent_terminated':
			return { symbol: '-', color: 'red' };
		case 'message_received':
			return { symbol: '<', color: 'blue' };
		case 'message_sent':
			return { symbol: '>', color: 'cyan' };
		case 'channel_connected':
			return { symbol: '*', color: 'green' };
		case 'error':
			return { symbol: '!', color: 'red' };
		default:
			return { symbol: '.', color: 'gray' };
	}
}

/**
 * Activity feed component showing recent system events.
 */
export function ActivityFeed({ limit = 10, events: externalEvents }: ActivityFeedProps): React.ReactElement {
	const [client] = useState<DaemonClient>(() => createClient());
	const [events, setEvents] = useState<ActivityEvent[]>(externalEvents ?? []);
	const [connected, setConnected] = useState(false);

	// Connect to daemon and subscribe to events
	useEffect(() => {
		if (externalEvents) {
			// Using external events, no need to connect
			return;
		}

		let unsubscribe: (() => void) | null = null;

		const connect = async () => {
			try {
				await client.connect();
				setConnected(true);

				// Subscribe to notifications
				unsubscribe = client.onNotification((method, params) => {
					const eventParams = params as {
						type?: string;
						message?: string;
						details?: Record<string, unknown>;
					};
					const eventType = eventParams.type ?? method;

					// Map notification to activity event
					let activityType: ActivityEvent['type'];
					switch (eventType) {
						case 'agent.spawned':
							activityType = 'agent_spawned';
							break;
						case 'agent.terminated':
							activityType = 'agent_terminated';
							break;
						case 'message.received':
							activityType = 'message_received';
							break;
						case 'message.sent':
							activityType = 'message_sent';
							break;
						case 'channel.connected':
							activityType = 'channel_connected';
							break;
						default:
							activityType = 'error';
					}

					const newEvent: ActivityEvent = {
						id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
						timestamp: new Date(),
						type: activityType,
						message: eventParams.message ?? method,
						details: eventParams.details,
					};

					setEvents((prev) => [newEvent, ...prev].slice(0, 50)); // Keep last 50 events
				});
			} catch {
				setConnected(false);
			}
		};

		void connect();

		return () => {
			unsubscribe?.();
			client.disconnect().catch(() => {});
		};
	}, [client, externalEvents]);

	// Update events when external events change
	useEffect(() => {
		if (externalEvents) {
			setEvents(externalEvents);
		}
	}, [externalEvents]);

	// Periodic refresh for relative times
	const [, setTick] = useState(0);
	useEffect(() => {
		const interval = setInterval(() => {
			setTick((t) => t + 1);
		}, 10000); // Update every 10 seconds
		return () => clearInterval(interval);
	}, []);

	const displayedEvents = events.slice(0, limit);

	if (displayedEvents.length === 0) {
		return (
			<Box>
				<Text color="gray">
					{connected || externalEvents ? 'No recent activity' : 'Connecting to daemon...'}
				</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{displayedEvents.map((event) => {
				const indicator = getActivityIndicator(event.type);
				return (
					<Box key={event.id}>
						<Text color={indicator.color}>[{indicator.symbol}]</Text>
						<Text> </Text>
						<Text color="gray">{formatRelativeTime(event.timestamp)}</Text>
						<Text> </Text>
						<Text>{event.message}</Text>
					</Box>
				);
			})}
		</Box>
	);
}
