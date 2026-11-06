import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Channel } from '@genii/comms/channel/types';
import type {
	ChannelLifecycleEvent,
	InboundEvent,
	IntentProcessedConfirmation,
	OutboundIntent,
} from '@genii/comms/events/types';
import { ChannelRegistryImpl } from '@genii/comms/registry/impl';
import { type ChannelStatus, createChannelId, type Disposable } from '@genii/comms/types/core';
import { RpcApplicationErrorCode, type RpcMethodResults, type RpcMethods } from '@genii/lib/rpc/methods';
import type { RpcNotification } from '@genii/lib/rpc/notifications';
import type { AgentAdapter } from '@genii/orchestrator/adapters/types';
import type { ContinueConfig, Coordinator } from '@genii/orchestrator/coordinator/types';
import type { AgentEvent, CoordinatorEvent } from '@genii/orchestrator/events/types';
import type { AgentHandle } from '@genii/orchestrator/handle/types';
import type { AgentCheckpoint } from '@genii/orchestrator/snapshot/types';
import type {
	AgentFilter,
	AgentInput,
	AgentSessionId,
	AgentSnapshot,
	AgentSpawnConfig,
	AgentStatus,
	CoordinatorStatus,
} from '@genii/orchestrator/types/core';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Daemon } from '../daemon';
import { createDaemonWithDeps } from '../factory';
import { createLogBuffer, type LogBuffer } from '../logging/buffer';
import type { Logger } from '../logging/logger';
import { SocketTransportClient } from '../transport/socket/client';

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL('../../../cli/bin/genii.ts', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const tsxImportUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const targetAgentId = 'agent-stream-target' as AgentSessionId;
const decoyAgentId = 'agent-stream-decoy' as AgentSessionId;
const fatalAgentId = 'agent-stream-fatal' as AgentSessionId;
const runningAgentId = 'agent-show-running' as AgentSessionId;
const completedAgentId = 'agent-show-completed' as AgentSessionId;
const parentAgentId = 'agent-show-parent' as AgentSessionId;

const runningAgentCreatedAt = new Date('2026-08-10T12:00:00.000Z');
const runningAgentSnapshotAt = Date.parse('2026-08-10T12:00:05.000Z');
const completedAgentCreatedAt = new Date('2026-08-10T13:00:00.000Z');
const completedAgentSnapshotAt = Date.parse('2026-08-10T13:00:12.000Z');
const testChannelId = createChannelId('telegram');

interface RunningCli {
	child: ChildProcess;
	exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	stderr: () => string;
	stdout: () => string;
}

interface TriggerLogger {
	logger: Logger;
	arm(trigger: () => void): void;
}

interface CliJsonEnvelope<T> {
	ok: boolean;
	data: T;
	timestamp: string;
}

interface CliJsonErrorEnvelope {
	ok: false;
	error: {
		message: string;
		code?: string;
	};
	timestamp: string;
}

type DaemonStatusJsonData = RpcMethodResults['daemon.status'] & { running: true };
type AgentShowJsonData = NonNullable<RpcMethodResults['agent.get']> & { duration: string };

interface TestAgentHandleOptions {
	status: AgentStatus;
	config?: AgentSpawnConfig;
	createdAt?: Date;
	snapshotTimestamp?: number;
	metrics?: AgentSnapshot['metrics'];
}

class ManualChannel implements Channel {
	readonly adapter = 'telegram';
	connectCalls = 0;
	disconnectCalls = 0;
	readonly id;

	private _connectGate:
		| {
				promise: Promise<void>;
				resolve: () => void;
		  }
		| undefined;
	private _status: ChannelStatus = 'disconnected';

	constructor(id = testChannelId) {
		this.id = id;
	}

	get status(): ChannelStatus {
		return this._status;
	}

	setStatus(status: ChannelStatus): void {
		this._status = status;
	}

	async process(intent: OutboundIntent): Promise<IntentProcessedConfirmation> {
		return { intentType: intent.type, success: true, timestamp: Date.now() };
	}

	async fetchMedia(_ref: string): Promise<ReadableStream<Uint8Array>> {
		return new ReadableStream<Uint8Array>();
	}

	subscribe(_handler: (event: InboundEvent) => void): Disposable {
		return () => {};
	}

	async *events(): AsyncIterable<InboundEvent> {}

	onLifecycle(_handler: (event: ChannelLifecycleEvent) => void): Disposable {
		return () => {};
	}

	deferNextConnect(): { resolve: () => void } {
		let resolve = () => {};
		const promise = new Promise<void>((complete) => {
			resolve = complete;
		});
		this._connectGate = { promise, resolve };
		return { resolve };
	}

	async connect(): Promise<void> {
		this.connectCalls += 1;
		this._status = 'connecting';
		const gate = this._connectGate;
		this._connectGate = undefined;
		await gate?.promise;
		this._status = 'connected';
	}

	async disconnect(): Promise<void> {
		this.disconnectCalls += 1;
		this._status = 'disconnected';
	}
}

function createAgentHandle(id: AgentSessionId, options: TestAgentHandleOptions): AgentHandle {
	const createdAt = options.createdAt ?? new Date('2026-08-10T00:00:00.000Z');
	const metrics = options.metrics ?? { durationMs: 1, turns: 1, toolCalls: 1 };

	return {
		id,
		status: options.status,
		config: options.config ?? { guidancePath: '/test/guidance' },
		createdAt,
		start: () => {},
		subscribe: () => () => {},
		async *events(): AsyncIterable<AgentEvent> {},
		send: async () => {},
		pause: async () => {},
		resume: async () => {},
		terminate: async () => {},
		wait: async () => ({
			status: 'completed',
			output: 'complete',
			metrics,
		}),
		snapshot: () => ({
			id: `${id}-snapshot`,
			sessionId: id,
			timestamp: options.snapshotTimestamp ?? createdAt.getTime(),
			status: options.status,
			metrics,
		}),
		getPendingRequests: () => [],
		resolve: async () => {},
	};
}

class ManualCoordinator implements Coordinator {
	private readonly _handlers = new Set<(event: CoordinatorEvent) => void>();
	private readonly _handles = new Map<AgentSessionId, AgentHandle>([
		[targetAgentId, createAgentHandle(targetAgentId, { status: 'completed' })],
		[fatalAgentId, createAgentHandle(fatalAgentId, { status: 'completed' })],
		[
			runningAgentId,
			createAgentHandle(runningAgentId, {
				status: 'running',
				config: {},
				createdAt: runningAgentCreatedAt,
				snapshotTimestamp: runningAgentSnapshotAt,
				metrics: { durationMs: 5_000, turns: 2, toolCalls: 1 },
			}),
		],
		[
			completedAgentId,
			createAgentHandle(completedAgentId, {
				status: 'completed',
				config: {
					guidancePath: '/test/guidance/completed',
					tags: ['issue-143', 'completed'],
					metadata: { source: 'rpc-integration' },
					parentId: parentAgentId,
				},
				createdAt: completedAgentCreatedAt,
				snapshotTimestamp: completedAgentSnapshotAt,
				metrics: {
					durationMs: 12_500,
					turns: 3,
					toolCalls: 2,
					tokensUsed: { input: 100, output: 25, total: 125 },
				},
			}),
		],
	]);
	private _status: CoordinatorStatus = 'stopped';

	async start(): Promise<void> {
		this._status = 'running';
	}

	async shutdown(): Promise<void> {
		this._status = 'stopped';
	}

	async spawn(_adapter: AgentAdapter, _config: AgentSpawnConfig): Promise<AgentHandle> {
		throw new Error('Spawn is not used by streaming integration tests');
	}

	async continue(
		_sessionId: AgentSessionId,
		_input: AgentInput,
		_adapter: AgentAdapter,
		_config?: ContinueConfig,
	): Promise<AgentHandle> {
		throw new Error('Continue is not used by streaming integration tests');
	}

	get(id: AgentSessionId): AgentHandle | undefined {
		return this._handles.get(id);
	}

	getAdapter(_id: AgentSessionId): AgentAdapter | undefined {
		return undefined;
	}

	list(_filter?: AgentFilter): AgentHandle[] {
		return [...this._handles.values()];
	}

	async listCheckpoints(): Promise<AgentSessionId[]> {
		return [];
	}

	async loadCheckpoint(_sessionId: AgentSessionId): Promise<AgentCheckpoint | null> {
		return null;
	}

	subscribe(handler: (event: CoordinatorEvent) => void): () => void {
		this._handlers.add(handler);
		return () => this._handlers.delete(handler);
	}

	get status(): CoordinatorStatus {
		return this._status;
	}

	emitAgentEvent(agentId: AgentSessionId, event: AgentEvent): void {
		const coordinatorEvent: CoordinatorEvent = {
			type: 'agent_event',
			sessionId: agentId,
			event,
			timestamp: Date.now(),
		};
		for (const handler of this._handlers) {
			handler(coordinatorEvent);
		}
	}
}

function createTriggerLogger(): TriggerLogger {
	const baseLogger = pino({ level: 'trace' }, { write: () => {} });
	let nextTrigger: (() => void) | undefined;

	const wrap = (current: Logger, component?: unknown): Logger =>
		new Proxy(current, {
			get(target, property) {
				if (property === 'child') {
					const createChild = target.child.bind(target) as unknown as (
						bindings: Record<string, unknown>,
						options?: Record<string, unknown>,
					) => Logger;
					return (bindings: Record<string, unknown>, options?: Record<string, unknown>) =>
						wrap(createChild(bindings, options), bindings.component ?? component);
				}
				if (property === 'debug' && component === 'SubscriptionManager') {
					return (_data: unknown, message?: string) => {
						if (message !== 'Created subscription' || !nextTrigger) {
							return;
						}
						const trigger = nextTrigger;
						nextTrigger = undefined;
						trigger();
					};
				}

				const value = Reflect.get(target, property, target) as unknown;
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});

	return {
		logger: wrap(baseLogger),
		arm: (trigger) => {
			nextTrigger = trigger;
		},
	};
}

function cliEnvironment(socketPath: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		GENII_SOCKET: socketPath,
		NO_COLOR: '1',
	};
}

async function runCli(socketPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	const { stdout, stderr } = await execFileAsync(process.execPath, ['--import', tsxImportUrl, cliPath, ...args], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		env: cliEnvironment(socketPath),
		timeout: 10_000,
	});
	return { stdout: String(stdout), stderr: String(stderr) };
}

function startCli(socketPath: string, args: string[]): RunningCli {
	const child = spawn(process.execPath, ['--import', tsxImportUrl, cliPath, ...args], {
		cwd: repositoryRoot,
		env: cliEnvironment(socketPath),
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	child.stdout?.on('data', (chunk: Buffer) => {
		stdout += chunk.toString('utf8');
	});
	child.stderr?.on('data', (chunk: Buffer) => {
		stderr += chunk.toString('utf8');
	});
	const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	return { child, exit, stdout: () => stdout, stderr: () => stderr };
}

function jsonLines(output: string): unknown[] {
	return output
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as unknown);
}

function jsonEnvelope<T>(output: string): CliJsonEnvelope<T> {
	return JSON.parse(output) as CliJsonEnvelope<T>;
}

async function waitFor(condition: () => boolean, describeCondition: string, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${describeCondition}`);
}

async function waitForValue<T>(
	read: () => Promise<T>,
	condition: (value: T) => boolean,
	describeCondition: string,
	timeoutMs = 5_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await read();
		if (condition(value)) {
			return value;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${describeCondition}`);
}

async function expectRequestError(client: SocketTransportClient, method: string, params: unknown): Promise<string> {
	try {
		await client.request(method, params);
		return '';
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

describe('CLI commands over a real daemon RPC socket', () => {
	let channelRegistry: ChannelRegistryImpl;
	let coordinator: ManualCoordinator;
	let daemon: Daemon | undefined;
	let logBuffer: LogBuffer;
	let socketPath: string;
	let testDirectory: string;
	let triggerLogger: TriggerLogger;
	let clients: SocketTransportClient[];
	let children: RunningCli[];

	beforeEach(async () => {
		testDirectory = await mkdtemp(join(tmpdir(), 'genii-streaming-rpc-'));
		socketPath = join(testDirectory, 'daemon.sock');
		channelRegistry = new ChannelRegistryImpl();
		coordinator = new ManualCoordinator();
		logBuffer = createLogBuffer();
		triggerLogger = createTriggerLogger();
		clients = [];
		children = [];
		daemon = await createDaemonWithDeps({
			socketPath,
			dataPath: testDirectory,
			guidancePath: join(testDirectory, 'guidance'),
			coordinator,
			channelRegistry,
			logger: triggerLogger.logger,
			logBuffer,
			logLevel: 'fatal',
		});
		await daemon.start();
	});

	function registerTestChannel(): ManualChannel {
		const channel = new ManualChannel();
		channelRegistry.register(channel);
		return channel;
	}

	async function runCliWithExit(args: string[]): Promise<{
		code: number | null;
		signal: NodeJS.Signals | null;
		stderr: string;
		stdout: string;
	}> {
		const running = startCli(socketPath, args);
		children.push(running);
		const { code, signal } = await running.exit;
		return { code, signal, stderr: running.stderr(), stdout: running.stdout() };
	}

	afterEach(async () => {
		for (const running of children) {
			if (running.child.exitCode === null && running.child.signalCode === null) {
				running.child.kill('SIGKILL');
			}
		}
		await Promise.allSettled(children.map((running) => running.exit));
		await Promise.allSettled(clients.map((client) => client.disconnect()));
		if (daemon?.status.state === 'running') {
			await daemon.stop('hard');
		}
		await rm(testDirectory, { recursive: true, force: true });
	});

	it('renders canonical daemon status in human mode', async () => {
		const result = await runCli(socketPath, ['daemon', 'status']);

		expect(result.stderr).toBe('');
		expect(result.stdout).toMatch(/^Status[ \t]+running$/m);
		expect(result.stdout).toMatch(/^Version[ \t]+1\.0\.0$/m);
		expect(result.stdout).toMatch(/^Uptime[ \t]+\S.*$/m);
		expect(result.stdout).toMatch(new RegExp(`^Agents[ \\t]+${coordinator.list().length}$`, 'm'));
		expect(result.stdout).toMatch(/^Channels[ \t]+0$/m);
		expect(result.stdout).not.toMatch(/^(?:PID|Conversations|Heap Used|Heap Total|RSS)[ \t]+/m);
		expect(result.stdout).not.toMatch(/undefined|Cannot read properties/i);
	});

	it('preserves canonical daemon status in JSON mode', async () => {
		const result = await runCli(socketPath, ['--output', 'json', 'daemon', 'status']);
		const envelope = jsonEnvelope<DaemonStatusJsonData>(result.stdout);

		expect(result.stderr).toBe('');
		expect(envelope.ok).toBe(true);
		expect(envelope.data).toMatchObject({
			running: true,
			status: 'running',
			agentCount: coordinator.list().length,
			channelCount: 0,
			version: '1.0.0',
		});
		expect(envelope.data.uptimeMs).toEqual(expect.any(Number));
		expect(envelope.data.uptimeMs).toBeGreaterThanOrEqual(0);
		expect(envelope.data).not.toHaveProperty('pid');
		expect(envelope.data).not.toHaveProperty('conversationCount');
		expect(envelope.data).not.toHaveProperty('memoryUsage');
	});

	it.each([
		['running', runningAgentId, '2026-08-10'],
		['completed', completedAgentId, '2026-08-10'],
	] as const)('renders a %s agent in human mode', async (status, agentId, timestampDate) => {
		const result = await runCli(socketPath, ['agent', 'show', agentId]);

		expect(result.stderr).toBe('');
		expect(result.stdout).toContain(agentId);
		expect(result.stdout).toMatch(new RegExp(`^Status[ \\t]+${status}$`, 'm'));
		expect(result.stdout).toMatch(new RegExp(`^Created At[ \\t]+${timestampDate}`, 'm'));
		expect(result.stdout).toMatch(new RegExp(`^Snapshot At[ \\t]+${timestampDate}`, 'm'));
		expect(result.stdout).toMatch(/^Duration[ \t]+\S.*$/m);
		expect(result.stdout).toMatch(/^Turns[ \t]+\d+$/m);
		expect(result.stdout).toMatch(/^Tool Calls[ \t]+\d+$/m);
		expect(result.stdout).not.toMatch(
			/^(?:Model|System Prompt|Temperature|Max Tokens|Last Active|Conversations|Bound Conversations)[ \t]+/m,
		);
		expect(result.stdout).not.toMatch(/undefined|Invalid time|Cannot read properties/i);

		if (status === 'completed') {
			expect(result.stdout).toMatch(/^Guidance Path[ \t]+\/test\/guidance\/completed$/m);
			expect(result.stdout).toMatch(new RegExp(`^Parent Session[ \\t]+${parentAgentId}$`, 'm'));
			expect(result.stdout).toMatch(/^Tags[ \t]+.*issue-143.*completed.*$/m);
			expect(result.stdout).toMatch(/^Metadata[ \t]+.*rpc-integration.*$/m);
			expect(result.stdout).toMatch(/^Tokens[ \t]+.*125.*$/m);
		} else {
			expect(result.stdout).not.toMatch(/^(?:Guidance Path|Parent Session|Tags|Metadata|Tokens)[ \t]+/m);
		}
	});

	it.each([
		['running', runningAgentId, runningAgentCreatedAt.toISOString()],
		['completed', completedAgentId, completedAgentCreatedAt.toISOString()],
	] as const)('preserves a %s agent in JSON mode', async (status, agentId, createdAt) => {
		const result = await runCli(socketPath, ['--output', 'json', 'agent', 'show', agentId]);
		const envelope = jsonEnvelope<AgentShowJsonData>(result.stdout);

		expect(result.stderr).toBe('');
		expect(envelope.ok).toBe(true);
		expect(envelope.data).toMatchObject({
			id: agentId,
			status,
			createdAt,
			duration: expect.any(String),
		});
		expect(envelope.data.duration.length).toBeGreaterThan(0);
		expect(envelope.data).not.toHaveProperty('model');
		expect(envelope.data).not.toHaveProperty('lastActiveAt');
		expect(envelope.data).not.toHaveProperty('conversationCount');
		expect(envelope.data).not.toHaveProperty('conversations');
		expect(envelope.data).not.toHaveProperty('snapshot');
		expect(envelope.data).not.toHaveProperty('metrics');

		if (status === 'completed') {
			expect(envelope.data).toMatchObject({
				guidancePath: '/test/guidance/completed',
				tags: ['issue-143', 'completed'],
				metadata: { source: 'rpc-integration' },
				parentId: parentAgentId,
			});
		} else {
			expect(envelope.data).not.toHaveProperty('guidancePath');
			expect(envelope.data).not.toHaveProperty('tags');
			expect(envelope.data).not.toHaveProperty('metadata');
			expect(envelope.data).not.toHaveProperty('parentId');
		}
	});

	it('shows a registered channel in human and canonical JSON modes', async () => {
		registerTestChannel();

		const human = await runCli(socketPath, ['channel', 'show', testChannelId]);
		expect(human.stderr).toBe('');
		expect(human.stdout).toMatch(/^Channel ID[ \t]+telegram$/m);
		expect(human.stdout).toMatch(/^Adapter[ \t]+telegram$/m);
		expect(human.stdout).toMatch(/^Status[ \t]+disconnected$/m);
		expect(human.stdout).not.toMatch(/Bound Conversations|undefined|Cannot read properties/i);

		const json = await runCli(socketPath, ['--output', 'json', 'channel', 'show', testChannelId]);
		const envelope = jsonEnvelope<NonNullable<RpcMethodResults['channel.get']>>(json.stdout);
		expect(json.stderr).toBe('');
		expect(envelope.ok).toBe(true);
		expect(envelope.data).toEqual({ id: testChannelId, type: 'telegram', status: 'disconnected' });
	});

	it('reports a missing channel deliberately in human and JSON modes', async () => {
		const human = await runCliWithExit(['channel', 'show', 'does-not-exist']);
		expect(human).toMatchObject({ code: 4, signal: null, stdout: '' });
		expect(human.stderr).toContain('Channel not found: does-not-exist');
		expect(human.stderr).not.toMatch(/Cannot read properties|Internal error/i);

		const json = await runCliWithExit(['--output', 'json', 'channel', 'show', 'does-not-exist']);
		const document = JSON.parse(json.stdout) as CliJsonErrorEnvelope;
		expect(json).toMatchObject({ code: 4, signal: null, stderr: '' });
		expect(document).toMatchObject({
			ok: false,
			error: { code: 'NOT_FOUND', message: 'Channel not found: does-not-exist' },
		});
	});

	it('connects and disconnects a registered channel idempotently', async () => {
		const channel = registerTestChannel();

		const connected = await runCli(socketPath, ['channel', 'connect', testChannelId]);
		expect(connected.stderr).toBe('');
		expect(connected.stdout).toContain(`Channel ${testChannelId} connected successfully`);
		expect(channel.status).toBe('connected');
		expect(channel.connectCalls).toBe(1);

		await runCli(socketPath, ['channel', 'connect', testChannelId]);
		expect(channel.connectCalls).toBe(1);

		const disconnected = await runCli(socketPath, ['channel', 'disconnect', testChannelId]);
		expect(disconnected.stderr).toBe('');
		expect(disconnected.stdout).toContain(`Channel ${testChannelId} disconnected successfully`);
		expect(channel.status).toBe('disconnected');
		expect(channel.disconnectCalls).toBe(1);

		await runCli(socketPath, ['channel', 'disconnect', testChannelId]);
		expect(channel.disconnectCalls).toBe(1);
	});

	it('does not start another connect while connecting or reconnecting', async () => {
		const channel = registerTestChannel();
		const client = new SocketTransportClient({ socketPath, reconnect: { enabled: false } }, triggerLogger.logger);
		clients.push(client);
		await client.connect();

		channel.setStatus('reconnecting');
		await expect(
			client.request<RpcMethodResults['channel.connect']>('channel.connect', {
				id: testChannelId,
			} satisfies RpcMethods['channel.connect']),
		).resolves.toEqual({ ok: true });
		expect(channel.connectCalls).toBe(0);

		channel.setStatus('connecting');
		await expect(
			client.request<RpcMethodResults['channel.connect']>('channel.connect', {
				id: testChannelId,
			} satisfies RpcMethods['channel.connect']),
		).resolves.toEqual({ ok: true });
		expect(channel.connectCalls).toBe(0);

		channel.setStatus('error');
		await expect(
			client.request<RpcMethodResults['channel.connect']>('channel.connect', {
				id: testChannelId,
			} satisfies RpcMethods['channel.connect']),
		).resolves.toEqual({ ok: true });
		expect(channel.connectCalls).toBe(1);
		expect(channel.status).toBe('connected');
	});

	it('serializes concurrent lifecycle requests behind an in-flight connect', async () => {
		const channel = registerTestChannel();
		const connectGate = channel.deferNextConnect();
		const client = new SocketTransportClient({ socketPath, reconnect: { enabled: false } }, triggerLogger.logger);
		clients.push(client);
		await client.connect();

		const firstConnect = client.request<RpcMethodResults['channel.connect']>('channel.connect', {
			id: testChannelId,
		} satisfies RpcMethods['channel.connect']);
		await waitFor(() => channel.status === 'connecting', 'deferred channel connect to start');

		let secondConnectSettled = false;
		const secondConnect = client
			.request<RpcMethodResults['channel.connect']>('channel.connect', {
				id: testChannelId,
			} satisfies RpcMethods['channel.connect'])
			.finally(() => {
				secondConnectSettled = true;
			});
		let disconnectSettled = false;
		const disconnect = client
			.request<RpcMethodResults['channel.disconnect']>('channel.disconnect', {
				id: testChannelId,
			} satisfies RpcMethods['channel.disconnect'])
			.finally(() => {
				disconnectSettled = true;
			});

		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(secondConnectSettled).toBe(false);
		expect(disconnectSettled).toBe(false);
		expect(channel.connectCalls).toBe(1);
		expect(channel.disconnectCalls).toBe(0);

		connectGate.resolve();
		await expect(Promise.all([firstConnect, secondConnect, disconnect])).resolves.toEqual([
			{ ok: true },
			{ ok: true },
			{ ok: true },
		]);
		expect(channel.connectCalls).toBe(1);
		expect(channel.disconnectCalls).toBe(1);
		expect(channel.status).toBe('disconnected');
	});

	it('reserves every startup connect before handling lifecycle requests', async () => {
		const startupDirectory = await mkdtemp(join(tmpdir(), 'genii-startup-channel-rpc-'));
		const startupSocketPath = join(startupDirectory, 'daemon.sock');
		const startupChannelRegistry = new ChannelRegistryImpl();
		const blockingChannel = new ManualChannel(createChannelId('startup-blocker'));
		const startupChannel = new ManualChannel();
		const blockingConnectGate = blockingChannel.deferNextConnect();
		const startupConnectGate = startupChannel.deferNextConnect();
		const startupLogger = createTriggerLogger();
		startupChannelRegistry.register(blockingChannel);
		startupChannelRegistry.register(startupChannel);

		const startupDaemon = await createDaemonWithDeps({
			socketPath: startupSocketPath,
			dataPath: startupDirectory,
			guidancePath: join(startupDirectory, 'guidance'),
			coordinator: new ManualCoordinator(),
			channelRegistry: startupChannelRegistry,
			logger: startupLogger.logger,
			logBuffer: createLogBuffer(),
			logLevel: 'fatal',
		});
		const startupClient = new SocketTransportClient(
			{ socketPath: startupSocketPath, reconnect: { enabled: false } },
			startupLogger.logger,
		);
		const startPromise = startupDaemon.start();
		let disconnectPromise: Promise<RpcMethodResults['channel.disconnect']> | undefined;

		try {
			await waitFor(
				() => blockingChannel.status === 'connecting' && startupChannel.status === 'connecting',
				'all startup channel connects to begin',
			);
			await startupClient.connect();

			let disconnectSettled = false;
			disconnectPromise = startupClient
				.request<RpcMethodResults['channel.disconnect']>('channel.disconnect', {
					id: testChannelId,
				} satisfies RpcMethods['channel.disconnect'])
				.finally(() => {
					disconnectSettled = true;
				});

			await expect(startupClient.request<RpcMethodResults['daemon.ping']>('daemon.ping', {})).resolves.toEqual({
				pong: true,
			});
			expect(disconnectSettled).toBe(false);
			expect(blockingChannel.connectCalls).toBe(1);
			expect(startupChannel.connectCalls).toBe(1);
			expect(startupChannel.disconnectCalls).toBe(0);

			blockingConnectGate.resolve();
			startupConnectGate.resolve();
			await expect(Promise.all([startPromise, disconnectPromise])).resolves.toEqual([undefined, { ok: true }]);
			expect(blockingChannel.connectCalls).toBe(1);
			expect(blockingChannel.status).toBe('connected');
			expect(startupChannel.connectCalls).toBe(1);
			expect(startupChannel.disconnectCalls).toBe(1);
			expect(startupChannel.status).toBe('disconnected');
			expect(startupDaemon.status.state).toBe('running');
		} finally {
			blockingConnectGate.resolve();
			startupConnectGate.resolve();
			await Promise.allSettled([startPromise, disconnectPromise ?? Promise.resolve()]);
			await startupClient.disconnect();
			if (startupDaemon.status.state === 'running') {
				await startupDaemon.stop('hard');
			}
			await rm(startupDirectory, { recursive: true, force: true });
		}
	});

	it('emits one canonical JSON result for connect and disconnect', async () => {
		const channel = registerTestChannel();

		const connected = await runCli(socketPath, ['--output', 'json', 'channel', 'connect', testChannelId]);
		expect(connected.stderr).toBe('');
		expect(jsonEnvelope<RpcMethodResults['channel.connect']>(connected.stdout)).toMatchObject({
			ok: true,
			data: { ok: true },
		});
		expect(channel.status).toBe('connected');

		const disconnected = await runCli(socketPath, ['--output', 'json', 'channel', 'disconnect', testChannelId]);
		expect(disconnected.stderr).toBe('');
		expect(jsonEnvelope<RpcMethodResults['channel.disconnect']>(disconnected.stdout)).toMatchObject({
			ok: true,
			data: { ok: true },
		});
		expect(channel.status).toBe('disconnected');
	});

	it.each(['connect', 'disconnect', 'reconnect'] as const)(
		'emits only a not-found JSON error when channel %s misses',
		async (command) => {
			const result = await runCliWithExit(['--output', 'json', 'channel', command, 'does-not-exist']);
			const document = JSON.parse(result.stdout) as CliJsonErrorEnvelope;

			expect(result).toMatchObject({ code: 4, signal: null, stderr: '' });
			expect(document).toMatchObject({
				ok: false,
				error: { code: 'NOT_FOUND', message: 'Channel not found: does-not-exist' },
			});
		},
	);

	it('returns the canonical not-found RPC code for a missing channel', async () => {
		const client = new SocketTransportClient({ socketPath, reconnect: { enabled: false } }, triggerLogger.logger);
		clients.push(client);
		await client.connect();

		await expect(
			client.request('channel.connect', {
				id: createChannelId('does-not-exist'),
			} satisfies RpcMethods['channel.connect']),
		).rejects.toMatchObject({
			code: RpcApplicationErrorCode.NotFound,
			message: 'Channel not found: does-not-exist',
		});
	});

	it('tails only the selected agent across replay, overlap, and live publication', async () => {
		const circularInput: Record<string, unknown> = { source: 'replay', count: 1n };
		circularInput.self = circularInput;
		coordinator.emitAgentEvent(decoyAgentId, {
			type: 'output',
			text: 'decoy output',
			final: true,
			timestamp: 1,
		});
		coordinator.emitAgentEvent(targetAgentId, {
			type: 'output',
			text: 'target replay output',
			final: true,
			timestamp: 2,
		});
		coordinator.emitAgentEvent(targetAgentId, {
			type: 'tool_start',
			toolCallId: 'tool-1',
			toolName: 'test-tool',
			input: circularInput,
			timestamp: 3,
		});

		triggerLogger.arm(() => {
			coordinator.emitAgentEvent(decoyAgentId, {
				type: 'output',
				text: 'decoy boundary output',
				final: true,
				timestamp: 4,
			});
			coordinator.emitAgentEvent(targetAgentId, {
				type: 'tool_end',
				toolCallId: 'tool-1',
				toolName: 'test-tool',
				output: { source: 'overlap', count: 2n },
				durationMs: 1,
				timestamp: 5,
			});
			setImmediate(() => {
				coordinator.emitAgentEvent(targetAgentId, {
					type: 'done',
					result: {
						status: 'completed',
						output: 'target complete',
						metrics: { durationMs: 2, turns: 1, toolCalls: 1 },
					},
					timestamp: 6,
				});
			});
		});

		const result = await runCli(socketPath, [
			'--output',
			'json',
			'agent',
			'tail',
			targetAgentId,
			'--include',
			'tools',
		]);
		const events = jsonLines(result.stdout) as Array<Record<string, unknown>>;

		expect(result.stderr).toBe('');
		expect(events.map((event) => event.type)).toEqual(['output', 'tool_start', 'tool_end', 'done']);
		expect(events.filter((event) => event.type === 'tool_end')).toHaveLength(1);
		expect(events.find((event) => event.type === 'tool_start')).toMatchObject({
			input: { source: 'replay', count: '1', self: '[Circular]' },
		});
		expect(events.find((event) => event.type === 'tool_end')).toMatchObject({
			output: { source: 'overlap', count: '2' },
		});
		expect(result.stdout).toContain('target replay output');
		expect(result.stdout).not.toContain('decoy');
	});

	it('stops tailing when a fast agent emits a fatal error', async () => {
		triggerLogger.arm(() => {
			coordinator.emitAgentEvent(fatalAgentId, {
				type: 'error',
				error: 'terminal failure',
				fatal: true,
				timestamp: 7,
			});
		});

		const result = await runCli(socketPath, ['--output', 'json', 'agent', 'tail', fatalAgentId]);
		const events = jsonLines(result.stdout) as Array<Record<string, unknown>>;

		expect(result.stderr).toBe('');
		expect(events).toEqual([expect.objectContaining({ type: 'error', error: 'terminal failure', fatal: true })]);
	});

	it('returns recent daemon logs and follows overlap plus new entries', async () => {
		for (const [timestamp, message] of [
			[1, 'discarded log'],
			[2, 'recent log one'],
			[3, 'recent log two'],
		] as const) {
			logBuffer.append({ timestamp, level: 'info', component: 'CommandTest', message });
		}

		const recent = await runCli(socketPath, [
			'--output',
			'json',
			'daemon',
			'logs',
			'--component',
			'CommandTest',
			'--lines',
			'2',
		]);
		const envelope = JSON.parse(recent.stdout) as {
			ok: boolean;
			data: { logs: Array<{ message: string; sequence: number }> };
		};
		expect(recent.stderr).toBe('');
		expect(envelope.ok).toBe(true);
		expect(envelope.data.logs.map((entry) => entry.message)).toEqual(['recent log one', 'recent log two']);

		logBuffer.append({ timestamp: 4, level: 'warn', component: 'FollowTest', message: 'follow replay' });
		triggerLogger.arm(() => {
			logBuffer.append({ timestamp: 5, level: 'warn', component: 'FollowTest', message: 'follow overlap' });
		});
		const following = startCli(socketPath, [
			'--output',
			'json',
			'daemon',
			'logs',
			'--follow',
			'--component',
			'FollowTest',
			'--lines',
			'2',
		]);
		children.push(following);
		await waitFor(() => jsonLines(following.stdout()).length >= 2, 'log replay and overlap output');
		logBuffer.append({ timestamp: 6, level: 'error', component: 'FollowTest', message: 'follow live' });
		await waitFor(() => jsonLines(following.stdout()).length >= 3, 'live log output');
		following.child.kill('SIGTERM');
		const exit = await following.exit;
		const entries = jsonLines(following.stdout()) as Array<{ message: string; sequence: number }>;

		expect(exit).toEqual({ code: 0, signal: null });
		expect(following.stderr()).toBe('');
		expect(entries.map((entry) => entry.message)).toEqual(['follow replay', 'follow overlap', 'follow live']);
		expect(entries.filter((entry) => entry.message === 'follow overlap')).toHaveLength(1);
		expect(entries.map((entry) => entry.sequence)).toEqual(
			[...entries.map((entry) => entry.sequence)].sort((a, b) => a - b),
		);
	});

	it('publishes canonical notifications and keeps cleanup connection-scoped', async () => {
		const first = new SocketTransportClient({ socketPath, reconnect: { enabled: false } }, triggerLogger.logger);
		const second = new SocketTransportClient({ socketPath, reconnect: { enabled: false } }, triggerLogger.logger);
		const observer = new SocketTransportClient({ socketPath, reconnect: { enabled: false } }, triggerLogger.logger);
		clients.push(first, second, observer);
		await Promise.all([first.connect(), second.connect(), observer.connect()]);

		const firstResult = await first.request<RpcMethodResults['subscribe.logs']>('subscribe.logs', {
			component: 'OwnerScope',
			limit: 0,
			follow: true,
		} satisfies RpcMethods['subscribe.logs']);
		const secondResult = await second.request<RpcMethodResults['subscribe.logs']>('subscribe.logs', {
			component: 'OwnerScope',
			limit: 0,
			follow: true,
		} satisfies RpcMethods['subscribe.logs']);
		expect(firstResult.entries).toEqual([]);
		expect(secondResult.entries).toEqual([]);

		await expectRequestError(first, 'unsubscribe', { subscriptionId: secondResult.subscriptionId }).then(
			(message) => expect(message).toContain("Cannot unsubscribe from another connection's subscription"),
		);

		const notificationPromise = new Promise<RpcNotification>((resolve) => {
			const disposable = second.onNotification((notification) => {
				if (
					notification.method === 'logs.entry' &&
					notification.params.subscriptionId === secondResult.subscriptionId
				) {
					disposable.dispose();
					resolve(notification);
				}
			});
		});
		const appended = logBuffer.append({
			timestamp: 10,
			level: 'error',
			component: 'OwnerScope',
			message: 'owner-scoped live log',
		});
		await expect(notificationPromise).resolves.toEqual({
			method: 'logs.entry',
			params: { subscriptionId: secondResult.subscriptionId, entry: appended },
		});

		const daemonLogResult = await observer.request<RpcMethodResults['subscribe.logs']>('subscribe.logs', {
			limit: 0,
			follow: true,
		} satisfies RpcMethods['subscribe.logs']);
		const daemonLogPromise = new Promise<RpcNotification>((resolve) => {
			const disposable = observer.onNotification((notification) => {
				if (
					notification.method === 'logs.entry' &&
					notification.params.subscriptionId === daemonLogResult.subscriptionId &&
					notification.params.entry.message === 'Reload requested via RPC'
				) {
					disposable.dispose();
					resolve(notification);
				}
			});
		});
		await observer.request<RpcMethodResults['daemon.reload']>(
			'daemon.reload',
			{} satisfies RpcMethods['daemon.reload'],
		);
		await expect(daemonLogPromise).resolves.toMatchObject({
			method: 'logs.entry',
			params: {
				subscriptionId: daemonLogResult.subscriptionId,
				entry: { level: 'info', message: 'Reload requested via RPC' },
			},
		});
		await expect(
			observer.request<RpcMethodResults['unsubscribe']>('unsubscribe', {
				subscriptionId: daemonLogResult.subscriptionId,
			} satisfies RpcMethods['unsubscribe']),
		).resolves.toEqual({ ok: true });

		await first.disconnect();
		const cleanupMessage = await waitForValue(
			() => expectRequestError(observer, 'unsubscribe', { subscriptionId: firstResult.subscriptionId }),
			(message) => message.includes('Subscription not found'),
			'disconnect subscription cleanup',
		);

		expect(cleanupMessage).toContain('Subscription not found');
		await expect(
			second.request<RpcMethodResults['unsubscribe']>('unsubscribe', {
				subscriptionId: secondResult.subscriptionId,
			} satisfies RpcMethods['unsubscribe']),
		).resolves.toEqual({ ok: true });
	});
});
