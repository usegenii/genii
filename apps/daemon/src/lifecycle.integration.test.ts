import { type ChildProcess, spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Coordinator } from '@genii/orchestrator/coordinator/types';
import type { CoordinatorStatus, ShutdownOptions } from '@genii/orchestrator/types/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { Daemon } from './daemon';
import { createDaemonWithDeps } from './factory';
import { createLogger } from './logging/logger';
import { ShutdownManager } from './shutdown/manager';
import { SocketTransportClient } from './transport/socket/client';

const cliPath = fileURLToPath(new URL('../../cli/bin/genii.ts', import.meta.url));
const daemonPath = fileURLToPath(new URL('../bin/daemon.ts', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxImportUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

interface ProcessExit {
	code: number | null;
	signal: NodeJS.Signals | null;
}

interface RunningProcess {
	child: ChildProcess;
	exit: Promise<ProcessExit>;
	stderr(): string;
	stdout(): string;
}

interface CliJsonEnvelope<T> {
	ok: boolean;
	data?: T;
	error?: {
		message: string;
		code?: string;
	};
	timestamp: string;
}

interface StopResult {
	stopped: boolean;
	mode?: 'graceful' | 'forced';
	reason?: 'not_running';
}

type ShutdownBehavior = (options: ShutdownOptions) => Promise<void>;

const runningProcesses: RunningProcess[] = [];
const runningDaemons: Daemon[] = [];
const testDirectories: string[] = [];
let nextPipeId = 1;

function deferred<T>(): Deferred<T> {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: (value) => resolvePromise?.(value),
	};
}

function delay(timeoutMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
	if (!signal) {
		return Promise.reject(new Error('Expected graceful shutdown to provide an abort signal'));
	}
	if (signal.aborted) {
		return Promise.resolve();
	}
	return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}

async function withDeadline<T>(promise: Promise<T>, description: string, timeoutMs = 5_000): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), timeoutMs);
	});

	try {
		return await Promise.race([promise, deadline]);
	} finally {
		if (timeout !== undefined) {
			clearTimeout(timeout);
		}
	}
}

async function waitFor(condition: () => boolean, description: string, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) {
			return;
		}
		await delay(10);
	}
	throw new Error(`Timed out waiting for ${description}`);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function createTestDirectory(name: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), `genii-lifecycle-${name}-`));
	testDirectories.push(directory);
	return directory;
}

function getSocketPath(directory: string, name: string): string {
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\genii-lifecycle-${process.pid}-${nextPipeId++}-${name}`;
	}
	return join(directory, `${name}.sock`);
}

function startProcess(command: string, args: string[], environment: NodeJS.ProcessEnv = process.env): RunningProcess {
	const child = spawn(command, args, {
		cwd: repositoryRoot,
		env: environment,
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
	const exit = new Promise<ProcessExit>((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	const running = { child, exit, stdout: () => stdout, stderr: () => stderr };
	runningProcesses.push(running);
	return running;
}

function cliEnvironment(socketPath: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		GENII_SOCKET: socketPath,
		NO_COLOR: '1',
	};
}

function startCli(socketPath: string, args: string[]): RunningProcess {
	return startProcess(
		process.execPath,
		['--import', tsxImportUrl, cliPath, '--output', 'json', ...args],
		cliEnvironment(socketPath),
	);
}

async function runCli(socketPath: string, args: string[]): Promise<ProcessExit & { stdout: string; stderr: string }> {
	const running = startCli(socketPath, args);
	const exit = await withDeadline(running.exit, `CLI ${args.join(' ')}`);
	return { ...exit, stdout: running.stdout(), stderr: running.stderr() };
}

function jsonEnvelope<T>(output: string): CliJsonEnvelope<T> {
	return JSON.parse(output) as CliJsonEnvelope<T>;
}

class LifecycleCoordinator implements Coordinator {
	readonly shutdownCalls: ShutdownOptions[] = [];
	teardownCompleted = false;

	private readonly _shutdownBehavior: ShutdownBehavior;
	private _status: CoordinatorStatus = 'stopped';

	constructor(shutdownBehavior: ShutdownBehavior = async () => {}) {
		this._shutdownBehavior = shutdownBehavior;
	}

	async start(): Promise<void> {
		this._status = 'running';
	}

	async shutdown(options: ShutdownOptions = {}): Promise<void> {
		this._status = 'stopping';
		this.shutdownCalls.push({ ...options });
		await this._shutdownBehavior(options);
		this.teardownCompleted = true;
		this._status = 'stopped';
	}

	spawn: Coordinator['spawn'] = async () => {
		throw new Error('Agent spawning is not used by lifecycle integration tests');
	};

	continue: Coordinator['continue'] = async () => {
		throw new Error('Agent continuation is not used by lifecycle integration tests');
	};

	get: Coordinator['get'] = () => undefined;
	getAdapter: Coordinator['getAdapter'] = () => undefined;
	list: Coordinator['list'] = () => [];
	listCheckpoints: Coordinator['listCheckpoints'] = async () => [];
	loadCheckpoint: Coordinator['loadCheckpoint'] = async () => null;
	subscribe: Coordinator['subscribe'] = () => () => {};

	get status(): CoordinatorStatus {
		return this._status;
	}
}

async function startInProcessDaemon(
	name: string,
	coordinator: LifecycleCoordinator,
	hardTimeoutMs: number,
): Promise<{ daemon: Daemon; socketPath: string }> {
	const directory = await createTestDirectory(name);
	const socketPath = getSocketPath(directory, 'daemon');
	const logger = createLogger({ level: 'fatal' });
	const shutdownManager = new ShutdownManager(logger, { hardTimeoutMs });
	const daemon = await createDaemonWithDeps({
		socketPath,
		dataPath: directory,
		guidancePath: join(directory, 'guidance'),
		coordinator,
		shutdownManager,
		logger,
		logLevel: 'fatal',
	});
	runningDaemons.push(daemon);
	await daemon.start();
	return { daemon, socketPath };
}

async function waitForDaemon(socketPath: string, processHandle: RunningProcess): Promise<void> {
	const deadline = Date.now() + 5_000;
	const logger = createLogger({ level: 'fatal' });
	while (Date.now() < deadline) {
		if (processHandle.child.exitCode !== null || processHandle.child.signalCode !== null) {
			throw new Error(`Daemon exited before becoming ready: ${processHandle.stderr()}`);
		}

		const client = new SocketTransportClient(
			{
				socketPath,
				connectTimeoutMs: 100,
				requestTimeoutMs: 250,
				reconnect: { enabled: false },
			},
			logger,
		);
		try {
			await client.connect();
			await client.request('daemon.ping', {});
			await client.disconnect();
			return;
		} catch {
			await client.disconnect();
			await delay(20);
		}
	}

	throw new Error(`Timed out waiting for daemon to listen: ${processHandle.stderr()}`);
}

afterEach(async () => {
	const processes = runningProcesses.splice(0);
	for (const running of processes) {
		if (running.child.exitCode === null && running.child.signalCode === null) {
			running.child.kill('SIGKILL');
		}
	}
	await Promise.allSettled(processes.map((running) => withDeadline(running.exit, 'child process cleanup', 2_000)));

	const daemons = runningDaemons.splice(0);
	await Promise.allSettled(daemons.map((daemon) => daemon.stop('hard')));

	const directories = testDirectories.splice(0);
	await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('daemon stop lifecycle over a real RPC socket', () => {
	it('returns a graceful outcome only after coordinator teardown completes', async () => {
		const teardown = deferred<void>();
		const coordinator = new LifecycleCoordinator(async () => teardown.promise);
		const { socketPath } = await startInProcessDaemon('graceful', coordinator, 100);
		const cli = startCli(socketPath, ['daemon', 'stop', '--timeout', '500']);

		await waitFor(() => coordinator.shutdownCalls.length === 1, 'coordinator shutdown to begin');
		expect(coordinator.teardownCompleted).toBe(false);
		expect(cli.child.exitCode).toBeNull();
		expect(cli.stdout()).not.toContain('"mode": "graceful"');

		teardown.resolve(undefined);
		const exit = await withDeadline(cli.exit, 'graceful CLI response');
		const envelope = jsonEnvelope<StopResult>(cli.stdout());

		expect(exit).toEqual({ code: 0, signal: null });
		expect(cli.stderr()).toBe('');
		expect(coordinator.teardownCompleted).toBe(true);
		expect(coordinator.shutdownCalls[0]).toMatchObject({ graceful: true });
		expect(coordinator.shutdownCalls[0]?.timeoutMs).toBeGreaterThan(0);
		expect(coordinator.shutdownCalls[0]?.timeoutMs).toBeLessThanOrEqual(500);
		expect(coordinator.shutdownCalls[0]?.signal?.aborted).toBe(false);
		expect(envelope).toMatchObject({
			ok: true,
			data: { stopped: true, mode: 'graceful' },
		});
	});

	it('reports forced termination when the graceful deadline escalates', async () => {
		const coordinator = new LifecycleCoordinator(async (options) => waitForAbort(options.signal));
		const { socketPath } = await startInProcessDaemon('escalation', coordinator, 100);

		const result = await runCli(socketPath, ['daemon', 'stop', '--timeout', '15']);
		const envelope = jsonEnvelope<StopResult>(result.stdout);

		expect(result.code).toBe(0);
		expect(result.signal).toBeNull();
		expect(result.stderr).toBe('');
		expect(coordinator.shutdownCalls).toHaveLength(1);
		expect(coordinator.shutdownCalls[0]).toMatchObject({ graceful: true });
		expect(coordinator.shutdownCalls[0]?.signal).toBeDefined();
		expect(coordinator.shutdownCalls[0]?.signal?.aborted).toBe(true);
		expect(coordinator.teardownCompleted).toBe(true);
		expect(envelope).toMatchObject({
			ok: true,
			data: { stopped: true, mode: 'forced' },
		});
	});

	it('allows a second forced request to escalate an in-progress graceful stop', async () => {
		const coordinator = new LifecycleCoordinator(async (options) => waitForAbort(options.signal));
		const { socketPath } = await startInProcessDaemon('concurrent-escalation', coordinator, 100);
		// Keep the graceful deadline well above CLI process startup so this
		// assertion cannot pass via timeout escalation on a slow runner.
		const gracefulCli = startCli(socketPath, ['daemon', 'stop', '--timeout', '30000']);

		await waitFor(() => coordinator.shutdownCalls.length === 1, 'graceful coordinator shutdown to begin');
		expect(coordinator.shutdownCalls[0]?.signal?.aborted).toBe(false);

		const forcedCli = startCli(socketPath, ['daemon', 'stop', '--force', '--timeout', '1']);
		await waitFor(
			() => coordinator.shutdownCalls[0]?.signal?.aborted === true,
			'forced request to escalate the in-progress graceful stop',
			10_000,
		);
		const [gracefulExit, forcedExit] = await Promise.all([
			withDeadline(gracefulCli.exit, 'graceful CLI escalation response', 10_000),
			withDeadline(forcedCli.exit, 'forced CLI escalation response', 10_000),
		]);
		const gracefulEnvelope = jsonEnvelope<StopResult>(gracefulCli.stdout());
		const forcedEnvelope = jsonEnvelope<StopResult>(forcedCli.stdout());

		expect(gracefulExit).toEqual({ code: 0, signal: null });
		expect(forcedExit).toEqual({ code: 0, signal: null });
		expect(gracefulCli.stderr()).toBe('');
		expect(forcedCli.stderr()).toBe('');
		expect(coordinator.shutdownCalls).toHaveLength(1);
		expect(coordinator.shutdownCalls[0]?.signal?.aborted).toBe(true);
		expect(coordinator.teardownCompleted).toBe(true);
		expect(gracefulEnvelope).toMatchObject({
			ok: true,
			data: { stopped: true, mode: 'forced' },
		});
		expect(forcedEnvelope).toMatchObject({
			ok: true,
			data: { stopped: true, mode: 'forced' },
		});
	});

	it('starts in forced mode immediately when --force is combined with --timeout 1', async () => {
		const coordinator = new LifecycleCoordinator();
		const { socketPath } = await startInProcessDaemon('forced', coordinator, 100);

		const result = await runCli(socketPath, ['daemon', 'stop', '--force', '--timeout', '1']);
		const envelope = jsonEnvelope<StopResult>(result.stdout);

		expect(result.code).toBe(0);
		expect(result.signal).toBeNull();
		expect(result.stderr).toBe('');
		expect(coordinator.shutdownCalls).toHaveLength(1);
		expect(coordinator.shutdownCalls[0]?.graceful).toBe(false);
		expect(coordinator.shutdownCalls[0]?.timeoutMs).toBeGreaterThan(0);
		expect(coordinator.shutdownCalls[0]?.timeoutMs).toBeLessThanOrEqual(100);
		expect(coordinator.shutdownCalls[0]?.signal).toBeUndefined();
		expect(coordinator.teardownCompleted).toBe(true);
		expect(envelope).toMatchObject({
			ok: true,
			data: { stopped: true, mode: 'forced' },
		});
	});

	it('returns nonzero when hard cleanup cannot finish within its budget', async () => {
		const blockedTeardown = deferred<void>();
		const coordinator = new LifecycleCoordinator(async () => blockedTeardown.promise);
		const { socketPath } = await startInProcessDaemon('incomplete-hard', coordinator, 20);

		const result = await runCli(socketPath, ['daemon', 'stop', '--force', '--timeout', '1']);
		const envelope = jsonEnvelope<StopResult>(result.stdout);

		expect(result.code).toBe(1);
		expect(result.signal).toBeNull();
		expect(result.stderr).toBe('');
		expect(coordinator.shutdownCalls).toHaveLength(1);
		expect(coordinator.shutdownCalls[0]?.graceful).toBe(false);
		expect(coordinator.teardownCompleted).toBe(false);
		expect(envelope).toMatchObject({
			ok: false,
			error: { message: 'Daemon shutdown did not complete', code: '-32000' },
		});

		blockedTeardown.resolve(undefined);
	});

	it('treats an absent daemon as an idempotent not-running outcome', async () => {
		const directory = await createTestDirectory('absent');
		const socketPath = getSocketPath(directory, 'absent');

		const result = await runCli(socketPath, ['daemon', 'stop', '--timeout', '25']);
		const envelope = jsonEnvelope<StopResult>(result.stdout);

		expect(result.code).toBe(0);
		expect(result.signal).toBeNull();
		expect(result.stderr).toBe('');
		expect(envelope).toMatchObject({
			ok: true,
			data: { stopped: false, reason: 'not_running' },
		});
	});

	it.skipIf(process.platform === 'win32')('treats a stale socket as a not-running daemon', async () => {
		const directory = await createTestDirectory('stale');
		const socketPath = getSocketPath(directory, 'stale');
		const staleListenerScript = [
			"const net = require('node:net');",
			'const server = net.createServer();',
			"server.listen(process.argv[1], () => process.stdout.write('ready\\n'));",
		].join('');
		const listener = startProcess(process.execPath, ['-e', staleListenerScript, socketPath]);

		await waitFor(() => listener.stdout().includes('ready'), 'stale listener to become ready');
		listener.child.kill('SIGKILL');
		await withDeadline(listener.exit, 'stale listener to exit');
		expect(await pathExists(socketPath)).toBe(true);

		const result = await runCli(socketPath, ['daemon', 'stop', '--timeout', '25']);
		const envelope = jsonEnvelope<StopResult>(result.stdout);

		expect(result.code).toBe(0);
		expect(result.signal).toBeNull();
		expect(result.stderr).toBe('');
		expect(envelope).toMatchObject({
			ok: true,
			data: { stopped: false, reason: 'not_running' },
		});
	});

	it('flushes the stop response, removes the socket, and exits the actual daemon process', async () => {
		const directory = await createTestDirectory('child-process');
		const socketPath = getSocketPath(directory, 'child');
		const daemon = startProcess(
			process.execPath,
			[
				'--import',
				tsxImportUrl,
				daemonPath,
				'--socket',
				socketPath,
				'--data',
				directory,
				'--guidance',
				join(directory, 'guidance'),
				'--log-level',
				'error',
			],
			{
				...process.env,
				NODE_ENV: 'test',
				VITEST: 'true',
			},
		);

		await waitForDaemon(socketPath, daemon);
		if (process.platform !== 'win32') {
			expect(await pathExists(socketPath)).toBe(true);
		}

		const result = await runCli(socketPath, ['daemon', 'stop', '--timeout', '500']);
		const envelope = jsonEnvelope<StopResult>(result.stdout);

		expect(result.code).toBe(0);
		expect(result.signal).toBeNull();
		expect(result.stderr).toBe('');
		expect(envelope).toMatchObject({
			ok: true,
			data: { stopped: true, mode: 'graceful' },
		});

		const daemonExit = await withDeadline(daemon.exit, 'actual daemon process to exit');
		expect(daemonExit).toEqual({ code: 0, signal: null });
		if (process.platform !== 'win32') {
			await waitFor(() => daemon.child.exitCode === 0, 'daemon child exit to be observable');
			expect(await pathExists(socketPath)).toBe(false);
		}
	}, 10_000);
});
