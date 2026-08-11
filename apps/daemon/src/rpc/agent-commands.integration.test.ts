import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createChannelId } from '@genii/comms/types/core';
import type { RpcMethodResults, RpcMethods } from '@genii/lib/rpc/methods';
import type { ModelFactory } from '@genii/models/factory';
import type { AgentAdapter } from '@genii/orchestrator/adapters/types';
import type { ContinueConfig, Coordinator } from '@genii/orchestrator/coordinator/types';
import type { AgentEvent, CoordinatorEvent } from '@genii/orchestrator/events/types';
import type { AgentHandle } from '@genii/orchestrator/handle/types';
import type { AgentCheckpoint } from '@genii/orchestrator/snapshot/types';
import {
	type AgentFilter,
	type AgentInput,
	type AgentSessionId,
	type AgentSpawnConfig,
	type AgentStatus,
	type CoordinatorStatus,
	createAgentSessionId,
} from '@genii/orchestrator/types/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Daemon } from '../daemon';
import { createDaemonWithDeps } from '../factory';
import { createLogger, type Logger } from '../logging/logger';
import { SocketTransportClient } from '../transport/socket/client';

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL('../../../cli/bin/genii.ts', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const tsxImportUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
}

interface JsonEnvelope<T> {
	ok: boolean;
	data?: T;
	error?: { message: string };
}

interface ModelFactoryCall {
	model: string;
	options: { thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' } | undefined;
}

class TestAgentHandle implements AgentHandle {
	readonly createdAt = new Date('2026-08-11T00:00:00.000Z');
	startCount = 0;

	constructor(
		readonly id: AgentSessionId,
		readonly status: AgentStatus,
		readonly config: AgentSpawnConfig = {},
	) {}

	start(): void {
		this.startCount += 1;
	}

	subscribe(_handler: (event: AgentEvent) => void): () => void {
		return () => {};
	}

	async *events(): AsyncIterable<AgentEvent> {}

	async send(_input: AgentInput): Promise<void> {}

	async pause(): Promise<void> {}

	async resume(): Promise<void> {}

	async terminate(_reason?: string): Promise<void> {}

	async wait() {
		return {
			status: 'completed' as const,
			metrics: { durationMs: 0, turns: 0, toolCalls: 0 },
		};
	}

	snapshot(): never {
		throw new Error('Snapshots are not used by agent command integration tests');
	}

	getPendingRequests(): [] {
		return [];
	}

	async resolve(): Promise<void> {}
}

class RecordingCoordinator implements Coordinator {
	readonly listFilters: Array<AgentFilter | undefined> = [];
	readonly spawnCalls: Array<{ adapter: AgentAdapter; config: AgentSpawnConfig; handle: TestAgentHandle }> = [];
	private readonly handles = new Map<AgentSessionId, TestAgentHandle>();
	private readonly handlers = new Set<(event: CoordinatorEvent) => void>();
	private _status: CoordinatorStatus = 'stopped';
	private nextSpawnId = 1;

	constructor() {
		for (const [id, status] of [
			['agent-running', 'running'],
			['agent-completed', 'completed'],
			['agent-initializing', 'initializing'],
			['agent-completing', 'completing'],
		] as const) {
			const sessionId = createAgentSessionId(id);
			this.handles.set(sessionId, new TestAgentHandle(sessionId, status));
		}
	}

	async start(): Promise<void> {
		this._status = 'running';
	}

	async shutdown(): Promise<void> {
		this._status = 'stopped';
	}

	async spawn(adapter: AgentAdapter, config: AgentSpawnConfig): Promise<AgentHandle> {
		const id = createAgentSessionId(`agent-spawned-${this.nextSpawnId++}`);
		const handle = new TestAgentHandle(id, 'running', config);
		this.handles.set(id, handle);
		this.spawnCalls.push({ adapter, config, handle });
		return handle;
	}

	async continue(
		_sessionId: AgentSessionId,
		_input: AgentInput,
		_adapter: AgentAdapter,
		_config?: ContinueConfig,
	): Promise<AgentHandle> {
		throw new Error('Continue is not used by agent command integration tests');
	}

	get(id: AgentSessionId): AgentHandle | undefined {
		return this.handles.get(id);
	}

	getAdapter(_id: AgentSessionId): AgentAdapter | undefined {
		return undefined;
	}

	list(filter?: AgentFilter): AgentHandle[] {
		this.listFilters.push(filter);
		let handles = [...this.handles.values()];
		if (filter?.status !== undefined) {
			const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
			handles = handles.filter((handle) => statuses.includes(handle.status));
		}
		if (filter?.tags && filter.tags.length > 0) {
			handles = handles.filter((handle) => filter.tags?.some((tag) => handle.config.tags?.includes(tag)));
		}
		if (filter?.parentId !== undefined) {
			handles = handles.filter((handle) => handle.config.parentId === filter.parentId);
		}
		return handles;
	}

	async listCheckpoints(): Promise<AgentSessionId[]> {
		return [];
	}

	async loadCheckpoint(_sessionId: AgentSessionId): Promise<AgentCheckpoint | null> {
		return null;
	}

	subscribe(handler: (event: CoordinatorEvent) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	get status(): CoordinatorStatus {
		return this._status;
	}
}

function createRecordingModelFactory(calls: ModelFactoryCall[]): ModelFactory {
	return {
		createAdapter: async (model: string, options: ModelFactoryCall['options']) => {
			calls.push({ model, options });
			return {
				name: 'recording-adapter',
				modelProvider: 'test',
				modelName: model,
			} as AgentAdapter;
		},
	} as ModelFactory;
}

function cliEnvironment(socketPath: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		GENII_SOCKET: socketPath,
		NO_COLOR: '1',
	};
}

async function runCli(socketPath: string, args: string[]): Promise<CliResult> {
	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, ['--import', tsxImportUrl, cliPath, ...args], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			env: cliEnvironment(socketPath),
			timeout: 10_000,
		});
		return { code: 0, stdout: String(stdout), stderr: String(stderr) };
	} catch (error) {
		const failed = error as Error & { code?: number; stdout?: string; stderr?: string };
		return {
			code: typeof failed.code === 'number' ? failed.code : 1,
			stdout: String(failed.stdout ?? ''),
			stderr: String(failed.stderr ?? ''),
		};
	}
}

function parseEnvelope<T>(result: CliResult): JsonEnvelope<T> {
	return JSON.parse(result.stdout) as JsonEnvelope<T>;
}

function expectIds(result: CliResult, ids: string[]): void {
	expect(result.code).toBe(0);
	expect(result.stderr).toBe('');
	const envelope = parseEnvelope<Array<{ id: string }>>(result);
	expect(envelope.ok).toBe(true);
	expect(envelope.data?.map((agent) => agent.id)).toEqual(ids);
}

describe('agent commands over a real daemon RPC socket', () => {
	let coordinator: RecordingCoordinator;
	let daemon: Daemon | undefined;
	let logger: Logger;
	let modelFactoryCalls: ModelFactoryCall[];
	let socketClients: SocketTransportClient[];
	let socketPath: string;
	let testDirectory: string;

	beforeEach(async () => {
		testDirectory = await mkdtemp(join(tmpdir(), 'genii-agent-commands-rpc-'));
		socketPath = join(testDirectory, 'daemon.sock');
		coordinator = new RecordingCoordinator();
		modelFactoryCalls = [];
		socketClients = [];
		logger = createLogger({ level: 'fatal' });
		daemon = await createDaemonWithDeps({
			socketPath,
			dataPath: testDirectory,
			guidancePath: join(testDirectory, 'guidance'),
			coordinator,
			modelFactory: createRecordingModelFactory(modelFactoryCalls),
			logger,
			logLevel: 'fatal',
		});
		await daemon.start();
	});

	afterEach(async () => {
		await Promise.allSettled(socketClients.map((client) => client.disconnect()));
		if (daemon?.status.state === 'running') {
			await daemon.stop('hard');
		}
		await rm(testDirectory, { recursive: true, force: true });
	});

	it('enforces single and multi-status filters with daemon OR semantics', async () => {
		const running = await runCli(socketPath, ['--output', 'json', 'agent', 'list', '--status', 'running']);
		expectIds(running, ['agent-running']);
		expect(coordinator.listFilters.at(-1)).toEqual({ status: ['running'] });

		const runningOrCompleted = await runCli(socketPath, [
			'--output',
			'json',
			'agent',
			'list',
			'--status',
			'running,completed',
		]);
		expectIds(runningOrCompleted, ['agent-running', 'agent-completed']);
		expect(coordinator.listFilters.at(-1)).toEqual({ status: ['running', 'completed'] });

		const transitional = await runCli(socketPath, [
			'--output',
			'json',
			'agent',
			'list',
			'--status',
			'initializing,completing',
		]);
		expectIds(transitional, ['agent-initializing', 'agent-completing']);
		expect(coordinator.listFilters.at(-1)).toEqual({ status: ['initializing', 'completing'] });
	});

	it('spawns with model, instruction, task, and an opaque bound destination', async () => {
		const result = await runCli(socketPath, [
			'--output',
			'json',
			'agent',
			'spawn',
			'Run the requested task',
			'--model',
			'test/model',
			'--task',
			'task-42',
			'--bind',
			'telegram:chat:thread:42',
		]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(parseEnvelope<{ id: string }>(result)).toMatchObject({
			ok: true,
			data: { id: 'agent-spawned-1' },
		});
		expect(modelFactoryCalls).toEqual([{ model: 'test/model', options: { thinkingLevel: undefined } }]);
		expect(coordinator.spawnCalls).toHaveLength(1);
		expect(coordinator.spawnCalls[0]?.config).toMatchObject({
			task: 'task-42',
			input: { message: 'Run the requested task' },
		});
		expect(coordinator.spawnCalls[0]?.handle.startCount).toBe(1);

		const destination = { channelId: createChannelId('telegram'), ref: 'chat:thread:42' };
		const socketClient = new SocketTransportClient({ socketPath, reconnect: { enabled: false } }, logger);
		socketClients.push(socketClient);
		await socketClient.connect();
		const conversation = await socketClient.request<RpcMethodResults['conversation.get']>('conversation.get', {
			destination,
		} satisfies RpcMethods['conversation.get']);
		expect(conversation).toMatchObject({ destination, agentId: 'agent-spawned-1' });

		const bound = await runCli(socketPath, ['--output', 'json', 'agent', 'list', '--channel', 'telegram']);
		expectIds(bound, ['agent-spawned-1']);
		const otherChannel = await runCli(socketPath, ['--output', 'json', 'agent', 'list', '--channel', 'slack']);
		expectIds(otherChannel, []);
	});

	it('rejects invalid list filters before making an RPC request', async () => {
		const initialCallCount = coordinator.listFilters.length;
		for (const args of [
			['--status', 'unknown'],
			['--status', ''],
			['--channel', ''],
		]) {
			const result = await runCli(socketPath, ['--output', 'json', 'agent', 'list', ...args]);
			expect(result.code).toBe(1);
			expect(parseEnvelope(result).ok).toBe(false);
		}
		expect(coordinator.listFilters).toHaveLength(initialCallCount);
	});

	it('rejects unsupported or invalid spawn options before making an RPC request', async () => {
		const cases: Array<{ args: string[]; message: string }> = [
			{ args: ['--name', 'named'], message: '--name is not supported' },
			{ args: ['--system-prompt', 'prompt'], message: '--system-prompt is not supported' },
			{ args: ['--task', ''], message: '--task requires a non-empty task ID' },
			{ args: ['--model', ''], message: '--model requires a non-empty model identifier' },
			{ args: ['--bind', ''], message: 'Invalid bind format' },
			{ args: ['--bind', 'telegram:'], message: 'Invalid bind format' },
		];

		for (const testCase of cases) {
			const result = await runCli(socketPath, ['--output', 'json', 'agent', 'spawn', ...testCase.args]);
			expect(result.code).toBe(1);
			expect(parseEnvelope(result).error?.message).toContain(testCase.message);
		}
		expect(coordinator.spawnCalls).toHaveLength(0);
		expect(modelFactoryCalls).toHaveLength(0);
	});
});
