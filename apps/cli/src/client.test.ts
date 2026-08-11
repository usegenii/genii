import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface RpcRequest {
	id: string;
	method: string;
}

interface PingServer {
	server: Server;
	requests: RpcRequest[];
}

interface ClientProbeInput {
	mode: 'onboard-status' | 'ping' | 'resolve';
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

async function startPingServer(socketPath: string, result: unknown = { pong: true }): Promise<PingServer> {
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
				socket.write(`${JSON.stringify({ id: request.id, result })}\n`);
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

	it('returns the authoritative onboarding data path from the daemon response', async () => {
		const socketPath = getDisposableSocketPath(testDirectory, 'onboard-status');
		const environment = createClientEnvironment(testDirectory);
		const status = {
			dataPath: 'C:\\Users\\genii\\AppData\\Local\\genii',
			guidancePath: 'D:\\shared\\custom-guidance',
			templates: ['SOUL.md', 'INSTRUCTIONS.md', 'PULSE.md'],
			existing: [],
		};
		const server = await startPingServer(socketPath, status);
		servers.push(server);

		const output = await runClientProbe({ mode: 'onboard-status', socketPath }, environment);

		expect(JSON.parse(output)).toEqual(status);
		expect(server.requests).toHaveLength(1);
		expect(server.requests[0]?.method).toBe('onboard.status');
	});

	it('rejects onboarding status from a daemon that predates the data path response', async () => {
		const socketPath = getDisposableSocketPath(testDirectory, 'old-onboard-status');
		const environment = createClientEnvironment(testDirectory);
		const priorStatus = {
			guidancePath: '/var/lib/genii/guidance',
			templates: ['SOUL.md', 'INSTRUCTIONS.md', 'PULSE.md'],
			existing: [],
		};
		const server = await startPingServer(socketPath, priorStatus);
		servers.push(server);

		await expect(runClientProbe({ mode: 'onboard-status', socketPath }, environment)).rejects.toMatchObject({
			stderr: expect.stringContaining(
				'The running Genii daemon returned an incompatible onboarding status without a data path. Upgrade Genii if needed, restart the daemon, then run onboarding again.',
			),
		});
		expect(server.requests).toHaveLength(1);
		expect(server.requests[0]?.method).toBe('onboard.status');
	});
});
