import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDaemonClient, type DaemonClient, type DaemonClientOptions, getSocketPath } from './client';

interface RpcRequest {
	id: string;
	method: string;
}

interface PingServer {
	server: Server;
	requests: RpcRequest[];
}

let nextPipeId = 1;

function restoreEnvironment(name: 'GENII_SOCKET' | 'XDG_RUNTIME_DIR', value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

function getDisposableSocketPath(directory: string, name: string): string {
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\genii-client-test-${process.pid}-${nextPipeId++}-${name}`;
	}

	return join(directory, `${name}.sock`);
}

async function startPingServer(socketPath: string): Promise<PingServer> {
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
				socket.write(`${JSON.stringify({ id: request.id, result: { pong: true } })}\n`);
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

describe('daemon client socket path precedence', () => {
	let clients: DaemonClient[];
	let originalGeniiSocket: string | undefined;
	let originalRuntimeDirectory: string | undefined;
	let servers: PingServer[];
	let testDirectory: string;

	beforeEach(async () => {
		originalGeniiSocket = process.env.GENII_SOCKET;
		originalRuntimeDirectory = process.env.XDG_RUNTIME_DIR;
		testDirectory = await mkdtemp(join(tmpdir(), 'genii-cli-client-'));
		clients = [];
		servers = [];
		delete process.env.GENII_SOCKET;
		process.env.XDG_RUNTIME_DIR = testDirectory;
	});

	afterEach(async () => {
		await Promise.all(clients.map((client) => client.disconnect()));
		await Promise.all(servers.map(({ server }) => closeServer(server)));
		restoreEnvironment('GENII_SOCKET', originalGeniiSocket);
		restoreEnvironment('XDG_RUNTIME_DIR', originalRuntimeDirectory);
		await rm(testDirectory, { recursive: true, force: true });
	});

	function createTrackedClient(options: DaemonClientOptions = {}): DaemonClient {
		const client = createDaemonClient({
			connectTimeoutMs: 1000,
			requestTimeoutMs: 1000,
			...options,
		});
		clients.push(client);
		return client;
	}

	async function expectPing(client: DaemonClient, pingServer: PingServer): Promise<void> {
		await client.connect();
		await expect(client.ping()).resolves.toEqual({ pong: true });
		expect(pingServer.requests).toHaveLength(1);
		expect(pingServer.requests[0]?.method).toBe('daemon.ping');
	}

	it('uses an explicit socket path before GENII_SOCKET', async () => {
		const explicitSocketPath = getDisposableSocketPath(testDirectory, 'explicit');
		process.env.GENII_SOCKET = getDisposableSocketPath(testDirectory, 'environment');
		const pingServer = await startPingServer(explicitSocketPath);
		servers.push(pingServer);

		const client = createTrackedClient({ socketPath: explicitSocketPath });

		await expectPing(client, pingServer);
	});

	it('uses GENII_SOCKET before the platform default', async () => {
		const environmentSocketPath = getDisposableSocketPath(testDirectory, 'environment');
		process.env.GENII_SOCKET = environmentSocketPath;
		const pingServer = await startPingServer(environmentSocketPath);
		servers.push(pingServer);

		const client = createTrackedClient();

		await expectPing(client, pingServer);
	});

	it('uses the platform default when no override is set', async () => {
		const defaultSocketPath =
			process.platform === 'win32' ? '\\\\.\\pipe\\genii-daemon' : join(testDirectory, 'genii-daemon.sock');
		expect(getSocketPath()).toBe(defaultSocketPath);

		if (process.platform === 'win32') {
			return;
		}

		const pingServer = await startPingServer(defaultSocketPath);
		servers.push(pingServer);
		const client = createTrackedClient();

		await expectPing(client, pingServer);
	});
});
