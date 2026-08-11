import type { Coordinator } from '@genii/orchestrator/coordinator/types';
import type { LogBuffer } from '../logging/buffer';
import type { AgentEventJournal } from './event-journal';
import type { SubscriptionManager } from './subscriptions';

export interface RuntimePublisher {
	dispose(): void;
}

export interface RuntimePublisherConfig {
	coordinator: Coordinator;
	agentEvents: AgentEventJournal;
	logs: LogBuffer;
	subscriptionManager: SubscriptionManager;
}

export function createRuntimePublisher(config: RuntimePublisherConfig): RuntimePublisher {
	const disposeCoordinator = config.coordinator.subscribe((event) => {
		if (event.type !== 'agent_event') {
			return;
		}
		const record = config.agentEvents.append(event.sessionId, event.event);
		config.subscriptionManager.notifyAgentOutput(record);
	});
	const disposeLogs = config.logs.subscribe((entry) => config.subscriptionManager.notifyLog(entry));

	let disposed = false;
	return {
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			disposeCoordinator();
			disposeLogs();
		},
	};
}
