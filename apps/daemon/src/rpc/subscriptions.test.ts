import type { AgentOutputRecord, LogEntry } from '@genii/lib/rpc/methods';
import type { AgentSessionId } from '@genii/orchestrator/types/core';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../logging/logger';
import type { RpcNotification, TransportConnection } from '../transport/types';
import { createSubscriptionManager } from './subscriptions';

function createConnection(id: string): TransportConnection & { notify: ReturnType<typeof vi.fn> } {
	return {
		id,
		metadata: {},
		notify: vi.fn<(notification: RpcNotification) => void>(),
		close: vi.fn(),
	};
}

describe('SubscriptionManager', () => {
	it('strictly filters agent output and cleans up only the disconnected connection', () => {
		const first = createConnection('first');
		const second = createConnection('second');
		const connections = new Map<string, TransportConnection>([
			[first.id, first],
			[second.id, second],
		]);
		const manager = createSubscriptionManager({
			logger: createLogger({ level: 'fatal' }),
			getConnection: (id) => connections.get(id),
		});
		const wantedAgent = 'agent-wanted' as AgentSessionId;
		const otherAgent = 'agent-other' as AgentSessionId;
		const wantedSubscription = manager.subscribe(first.id, 'agent.output', { agentId: wantedAgent });
		manager.subscribe(second.id, 'agent.output', { agentId: otherAgent });

		const record: AgentOutputRecord = {
			sequence: 1,
			agentId: wantedAgent,
			event: { type: 'output', text: 'hello', final: false, timestamp: 1 },
		};
		manager.notifyAgentOutput(record);

		expect(first.notify).toHaveBeenCalledWith({
			method: 'agent.output',
			params: { subscriptionId: wantedSubscription, ...record },
		});
		expect(second.notify).not.toHaveBeenCalled();

		manager.cleanup(first.id);
		expect(manager.getSubscriptions(first.id)).toEqual([]);
		expect(manager.getSubscriptions(second.id)).toHaveLength(1);
		expect(manager.count).toBe(1);
	});

	it('publishes live logs only to following subscriptions whose filters match', () => {
		const replayOnly = createConnection('replay-only');
		const following = createConnection('following');
		const filtered = createConnection('filtered');
		const connections = new Map<string, TransportConnection>([
			[replayOnly.id, replayOnly],
			[following.id, following],
			[filtered.id, filtered],
		]);
		const manager = createSubscriptionManager({
			logger: createLogger({ level: 'fatal' }),
			getConnection: (id) => connections.get(id),
		});
		manager.subscribe(replayOnly.id, 'logs', { component: 'rpc', follow: false });
		const followingSubscription = manager.subscribe(following.id, 'logs', {
			component: 'rpc',
			follow: true,
		});
		manager.subscribe(filtered.id, 'logs', { component: 'worker', follow: true });

		const entry: LogEntry = {
			sequence: 1,
			timestamp: 1,
			level: 'info',
			component: 'rpc',
			message: 'request handled',
		};
		manager.notifyLog(entry);

		expect(replayOnly.notify).not.toHaveBeenCalled();
		expect(filtered.notify).not.toHaveBeenCalled();
		expect(following.notify).toHaveBeenCalledWith({
			method: 'logs.entry',
			params: { subscriptionId: followingSubscription, entry },
		});
	});
});
