import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDaemonClient } from './client';

interface RpcRequest {
	id: string;
	method: string;
	params?: unknown;
}

interface PingServer {
	server: Server;
	requests: RpcRequest[];
}

interface ClientProbeInput {
	mode: 'ping' | 'resolve';
	socketPath?: string;
}

const execFileAsync = promisify(execFile);
const clientProbePath = fileURLToPath(new URL('../test-harness/client-probe.ts', import.meta.url));
const tsxImportUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
let nextPipeId = 1;

function createClientEnvironment(runtimeDirectory: string, geniiSocket?: string): NodeJS.ProcessEnv {
	const inheritedEnvironment = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => name !== 'GENII_SOCKET' && name !== 'XDG_RUNTIME_DIR'),
	);

	return {
		...inheritedEnvironment,
		XDG_RUNTIME_DIR: runtimeDirectory,
		...(geniiSocket === undefined ? {} : { GENII_SOCKET: geniiSocket }),
	};
}

function getDisposableSocketPath(directory: string, name: string): string {
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\genii-client-test-${process.pid}-${nextPipeId++}-${name}`;
	}

	return join(directory, `${name}.sock`);
}

async function startPingServer(socketPath: string, responseDelayMs = 0): Promise<PingServer> {
	const requests: RpcRequest[] = [];
	const server = createServer((socket) => {
		let buffer = '';
		socket.on('data', (chunk: Buffer) => {
			buffer += chunk.toString('utf8');
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				if (!line.trim()) {
					continue;
				}

				const request = JSON.parse(line) as RpcRequest;
				requests.push(request);
				const result =
					request.method === 'daemon.shutdown'
						? { ok: true, termination: 'forced' as const }
						: { pong: true as const };
				const respond = (): void => {
					socket.write(`${JSON.stringify({ id: request.id, result })}\n`);
				};

				if (responseDelayMs > 0) {
					setTimeout(respond, responseDelayMs);
				} else {
					respond();
				}
			}
		});
	});

	await new Promise<void>((resolve, reject) => {
		const handleError = (error: Error): void => reject(error);
		server.once('error', handleError);
		server.listen(socketPath, () => {
			server.off('error', handleError);
			resolve();
		});
	});

	return { server, requests };
}

async function closeServer(server: Server): Promise<void> {
	if (!server.listening) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
}

async function runClientProbe(input: ClientProbeInput, environment: NodeJS.ProcessEnv): Promise<string> {
	const { stdout } = await execFileAsync(
		process.execPath,
		['--import', tsxImportUrl, clientProbePath, JSON.stringify(input)],
		{
			encoding: 'utf8',
			env: environment,
			timeout: 5000,
		},
	);

	return stdout.toString();
}

describe('SocketDaemonClient socket path resolution', () => {
	let servers: PingServer[];
	let testDirectory: string;

	beforeEach(async () => {
		testDirectory = await mkdtemp(join(tmpdir(), 'genii-cli-client-'));
		servers = [];
	});

	afterEach(async () => {
		await Promise.all(servers.map(({ server }) => closeServer(server)));
		await rm(testDirectory, { recursive: true, force: true });
	});

	async function expectPing(
		input: ClientProbeInput,
		environment: NodeJS.ProcessEnv,
		pingServer: PingServer,
	): Promise<void> {
		await runClientProbe(input, environment);
		expect(pingServer.requests).toHaveLength(1);
		expect(pingServer.requests[0]?.method).toBe('daemon.ping');
	}

	it('prefers an explicit socket path over GENII_SOCKET', async () => {
		const explicitSocketPath = getDisposableSocketPath(testDirectory, 'explicit');
		const environmentSocketPath = getDisposableSocketPath(testDirectory, 'environment');
		const environment = createClientEnvironment(testDirectory, environmentSocketPath);
		const pingServer = await startPingServer(explicitSocketPath);
		servers.push(pingServer);

		await expectPing({ mode: 'ping', socketPath: explicitSocketPath }, environment, pingServer);
	});

	it('uses GENII_SOCKET when no explicit socket path is provided', async () => {
		const environmentSocketPath = getDisposableSocketPath(testDirectory, 'environment');
		const environment = createClientEnvironment(testDirectory, environmentSocketPath);
		const pingServer = await startPingServer(environmentSocketPath);
		servers.push(pingServer);

		await expectPing({ mode: 'ping' }, environment, pingServer);
	});

	it('uses the platform default when neither an explicit path nor GENII_SOCKET is provided', async () => {
		const environment = createClientEnvironment(testDirectory);
		const defaultSocketPath =
			process.platform === 'win32' ? '\\\\.\\pipe\\genii-daemon' : join(testDirectory, 'genii-daemon.sock');

		expect(await runClientProbe({ mode: 'resolve' }, environment)).toBe(defaultSocketPath);

		if (process.platform === 'win32') {
			return;
		}

		const pingServer = await startPingServer(defaultSocketPath);
		servers.push(pingServer);
		await expectPing({ mode: 'ping' }, environment, pingServer);
	});

	it('sends canonical shutdown parameters and allows the lifecycle response to exceed the default request timeout', async () => {
		const socketPath = getDisposableSocketPath(testDirectory, 'shutdown');
		const pingServer = await startPingServer(socketPath, 50);
		servers.push(pingServer);
		const client = createDaemonClient({ socketPath, connectTimeoutMs: 1000, requestTimeoutMs: 10 });

		await client.connect();
		try {
			await expect(client.shutdown({ graceful: true, timeoutMs: 25 })).resolves.toEqual({
				ok: true,
				termination: 'forced',
			});
		} finally {
			await client.disconnect();
		}

		expect(pingServer.requests).toEqual([
			{
				id: 'req-1',
				method: 'daemon.shutdown',
				params: { graceful: true, timeoutMs: 25 },
			},
		]);
	});

	it('canonicalizes the legacy positional shutdown arguments', async () => {
		const socketPath = getDisposableSocketPath(testDirectory, 'legacy-shutdown');
		const pingServer = await startPingServer(socketPath);
		servers.push(pingServer);
		const client = createDaemonClient({ socketPath, connectTimeoutMs: 1000 });

		await client.connect();
		try {
			await expect(client.shutdown('hard', 17)).resolves.toEqual({
				ok: true,
				termination: 'forced',
			});
		} finally {
			await client.disconnect();
		}

		expect(pingServer.requests).toEqual([
			{
				id: 'req-1',
				method: 'daemon.shutdown',
				params: { graceful: false, timeoutMs: 17 },
			},
		]);
	});
});
