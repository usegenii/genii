import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { RpcMethodResults, RpcMethods } from '@genii/lib/rpc/methods';
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
	AgentSpawnConfig,
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

function createTargetHandle(id: AgentSessionId): AgentHandle {
	return {
		id,
		status: 'completed',
		config: { guidancePath: '/test/guidance' },
		createdAt: new Date(),
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
			metrics: { durationMs: 1, turns: 1, toolCalls: 1 },
		}),
		snapshot: () => {
			throw new Error('Snapshot is not used by streaming integration tests');
		},
		getPendingRequests: () => [],
		resolve: async () => {},
	};
}

class ManualCoordinator implements Coordinator {
	private readonly _handlers = new Set<(event: CoordinatorEvent) => void>();
	private readonly _targetHandle = createTargetHandle(targetAgentId);
	private readonly _fatalHandle = createTargetHandle(fatalAgentId);
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
		if (id === targetAgentId) {
			return this._targetHandle;
		}
		return id === fatalAgentId ? this._fatalHandle : undefined;
	}

	getAdapter(_id: AgentSessionId): AgentAdapter | undefined {
		return undefined;
	}

	list(_filter?: AgentFilter): AgentHandle[] {
		return [this._targetHandle, this._fatalHandle];
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

describe('streaming commands over a real daemon RPC socket', () => {
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
			logger: triggerLogger.logger,
			logBuffer,
			logLevel: 'fatal',
		});
		await daemon.start();
	});

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
