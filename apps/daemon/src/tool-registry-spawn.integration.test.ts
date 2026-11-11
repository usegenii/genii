import type { InboundEvent } from '@genii/comms/events/types';
import type { ChannelRegistry } from '@genii/comms/registry/types';
import type { ChannelId } from '@genii/comms/types/core';
import type { ModelFactory } from '@genii/models/factory';
import type { AdapterCreateConfig, AgentAdapter, AgentInstance } from '@genii/orchestrator/adapters/types';
import { createCoordinator } from '@genii/orchestrator/coordinator/impl';
import { createDateTimeTool } from '@genii/orchestrator/tools/datetime/tool';
import { createToolRegistry } from '@genii/orchestrator/tools/registry';
import { createShellTool } from '@genii/orchestrator/tools/shell/tool';
import { createAgentSessionId } from '@genii/orchestrator/types/core';
import { describe, expect, it } from 'vitest';
import { ConversationManager } from './conversations/manager';
import { createLogger } from './logging/logger';
import { MessageRouter } from './router/router';
import { createHandlers, type RpcHandlerContext } from './rpc/handlers';
import { createSubscriptionManager } from './rpc/subscriptions';
import { ShutdownManager } from './shutdown/manager';

const GUIDANCE_PATH = '/tmp/genii-tool-registry-spawn-integration-guidance';

function createTestInstance(id: string): AgentInstance {
	return {
		id,
		async *run() {
			yield {
				type: 'done',
				result: {
					status: 'completed',
					output: 'done',
					metrics: { durationMs: 0, turns: 0, toolCalls: 0 },
				},
				timestamp: Date.now(),
			};
		},
		send: () => {},
		pause: async () => {},
		resume: async () => {},
		abort: () => {},
		checkpoint: async () => ({
			timestamp: Date.now(),
			adapterName: 'capture-adapter',
			session: {
				id: createAgentSessionId(id),
				createdAt: Date.now(),
				tags: [],
				metadata: {},
				metrics: { durationMs: 0, turns: 0, toolCalls: 0 },
			},
			guidance: {
				guidancePath: GUIDANCE_PATH,
				memoryWrites: [],
				systemState: {},
			},
			messages: [],
			adapterConfig: {},
			toolExecutions: [],
		}),
		status: () => 'idle',
		getPendingRequests: () => [],
		resolve: () => {},
	};
}

function createCaptureAdapter(id: string, capture: (config: AdapterCreateConfig) => void): AgentAdapter {
	return {
		name: 'capture-adapter',
		modelProvider: 'test-provider',
		modelName: 'test-model',
		create: async (config) => {
			capture(config);
			return createTestInstance(id);
		},
		restore: async (_checkpoint, config) => {
			capture(config);
			return createTestInstance(id);
		},
	};
}

function createChannelRegistry(): ChannelRegistry {
	return {
		register: () => {},
		unregister: () => {},
		get: () => undefined,
		list: () => [],
		subscribe: () => () => {},
		events: () => ({
			[Symbol.asyncIterator]: async function* () {},
		}),
		process: async () => ({
			intentType: 'agent_responding',
			success: true,
			timestamp: Date.now(),
		}),
	};
}

function createInboundMessage(channelId: ChannelId): InboundEvent {
	return {
		type: 'message_received',
		origin: {
			channelId,
			ref: 'channel-user',
			metadata: { conversationType: 'direct' },
		},
		author: {
			id: 'user-1',
			username: 'test-user',
			isBot: false,
		},
		content: {
			type: 'text',
			text: 'Spawn from a channel',
		},
		timestamp: Date.now(),
	};
}

function toolNames(config: AdapterCreateConfig | undefined): string[] {
	return (
		config?.tools
			?.all()
			.map((tool) => tool.name)
			.sort() ?? []
	);
}

describe('daemon tool registry spawn integration', () => {
	it('exposes the same tool set to CLI/RPC- and channel-spawned agents', async () => {
		const logger = createLogger({ level: 'fatal' });
		const coordinator = createCoordinator({ defaultGuidancePath: GUIDANCE_PATH });
		const channelRegistry = createChannelRegistry();
		const conversationManager = new ConversationManager(logger);
		const toolRegistry = createToolRegistry();
		toolRegistry.register(
			createShellTool({
				defaultTimeout: 1_000,
				maxOutputLength: 1_024,
			}),
		);
		toolRegistry.register(createDateTimeTool({ timezone: 'UTC' }));

		let rpcAdapterConfig: AdapterCreateConfig | undefined;
		let channelAdapterConfig: AdapterCreateConfig | undefined;
		const rpcAdapter = createCaptureAdapter('rpc-agent', (config) => {
			rpcAdapterConfig = config;
		});
		const channelAdapter = createCaptureAdapter('channel-agent', (config) => {
			channelAdapterConfig = config;
		});
		const modelFactory = {
			createAdapter: async () => rpcAdapter,
		} as unknown as ModelFactory;
		const subscriptionManager = createSubscriptionManager({
			logger,
			getConnection: () => undefined,
		});
		const context: RpcHandlerContext = {
			coordinator,
			channelRegistry,
			conversationManager,
			config: {
				socketPath: '/tmp/genii-tool-registry-spawn-integration.sock',
				storagePath: '/tmp/genii-tool-registry-spawn-integration',
				guidancePath: GUIDANCE_PATH,
				logLevel: 'fatal',
				startTime: Date.now(),
				version: 'test',
			},
			shutdownManager: new ShutdownManager(logger),
			stopRpcServer: async () => {},
			subscriptionManager,
			requestId: 'integration-request',
			connection: {
				id: 'integration-connection',
				metadata: {},
				notify: () => {},
				onResponseSettled: (_requestId, _callback) => {},
				close: () => {},
			},
			logger,
			modelFactory,
			toolRegistry,
		};

		await coordinator.start();

		try {
			const spawnHandler = createHandlers(context).get('agent.spawn');
			if (!spawnHandler) {
				throw new Error('agent.spawn handler is not registered');
			}

			await spawnHandler(
				{
					model: 'test-provider/test-model',
					input: { message: 'Spawn from CLI/RPC' },
				},
				context,
			);

			const router = new MessageRouter({
				coordinator,
				channelRegistry,
				conversationManager,
				adapterFactory: async () => channelAdapter,
				defaultSpawnContext: { guidancePath: GUIDANCE_PATH },
				logger,
				toolRegistry,
			});
			const channelId = 'integration-channel' as ChannelId;
			await router.handleInbound(createInboundMessage(channelId), channelId);

			expect(rpcAdapterConfig?.tools).toBe(toolRegistry);
			expect(channelAdapterConfig?.tools).toBe(toolRegistry);

			const expectedToolNames = ['datetime', 'shell'];
			expect(toolNames(rpcAdapterConfig)).toEqual(expectedToolNames);
			expect(toolNames(channelAdapterConfig)).toEqual(expectedToolNames);
			expect(toolNames(rpcAdapterConfig)).toEqual(toolNames(channelAdapterConfig));
		} finally {
			await coordinator.shutdown({ graceful: false });
		}
	});
});
