import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface RpcRequest {
	id: string;
	method: string;
	params?: unknown;
}

interface ShutdownServer {
	server: Server;
	requests: RpcRequest[];
}

interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
}

interface RpcResponseSpec {
	result?: unknown;
	error?: { code: number; message: string };
}

const cliPath = fileURLToPath(new URL('../../../bin/genii.ts', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const tsxImportUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
let nextPipeId = 1;

function getDisposableSocketPath(directory: string, name: string): string {
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\genii-stop-test-${process.pid}-${nextPipeId++}-${name}`;
	}

	return join(directory, `${name}.sock`);
}

async function createShutdownServer(socketPath: string, response: RpcResponseSpec): Promise<ShutdownServer> {
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
				socket.write(`${JSON.stringify({ id: request.id, ...response })}\n`);
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

function runCli(socketPath: string, args: string[]): Promise<CliResult> {
	return new Promise((resolve) => {
		execFile(
			process.execPath,
			['--import', tsxImportUrl, cliPath, ...args],
			{
				cwd: repositoryRoot,
				encoding: 'utf8',
				env: { ...process.env, GENII_SOCKET: socketPath, NO_COLOR: '1' },
				timeout: 10_000,
			},
			(error, stdout, stderr) => {
				resolve({
					code: error && typeof error.code === 'number' ? error.code : 0,
					stdout: String(stdout),
					stderr: String(stderr),
				});
			},
		);
	});
}

describe('daemon stop command', () => {
	let servers: ShutdownServer[];
	let testDirectory: string;

	beforeEach(async () => {
		testDirectory = await mkdtemp(join(tmpdir(), 'genii-cli-stop-'));
		servers = [];
	});

	afterEach(async () => {
		await Promise.all(servers.map(({ server }) => closeServer(server)));
		await rm(testDirectory, { recursive: true, force: true });
	});

	it.each([
		{
			name: 'graceful',
			args: ['daemon', 'stop', '--timeout', '17'],
			termination: 'graceful',
			params: { graceful: true, timeoutMs: 17 },
		},
		{
			name: 'forced',
			args: ['daemon', 'stop', '--force', '--timeout', '17'],
			termination: 'forced',
			params: { graceful: false, timeoutMs: 17 },
		},
	] as const)('reports an authoritative $name termination in human output', async ({ args, params, termination }) => {
		const socketPath = getDisposableSocketPath(testDirectory, termination);
		const shutdownServer = await createShutdownServer(socketPath, {
			result: { ok: true, termination },
		});
		servers.push(shutdownServer);

		const result = await runCli(socketPath, [...args]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain(`Daemon stopped: ${termination} termination`);
		expect(shutdownServer.requests).toEqual([
			{
				id: 'req-1',
				method: 'daemon.shutdown',
				params,
			},
		]);
	});

	it('reports timeout escalation using the returned forced termination in JSON', async () => {
		const socketPath = getDisposableSocketPath(testDirectory, 'escalated');
		const shutdownServer = await createShutdownServer(socketPath, {
			result: { ok: true, termination: 'forced' },
		});
		servers.push(shutdownServer);

		const result = await runCli(socketPath, ['--output', 'json', 'daemon', 'stop', '--timeout', '0']);
		const envelope = JSON.parse(result.stdout) as {
			ok: boolean;
			data: { stopped: boolean; mode: string };
		};

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(envelope).toMatchObject({ ok: true, data: { stopped: true, mode: 'forced' } });
		expect(shutdownServer.requests[0]?.params).toEqual({ graceful: true, timeoutMs: 0 });
	});

	it('treats an absent daemon listener as an idempotent JSON success', async () => {
		const socketPath = getDisposableSocketPath(testDirectory, 'absent');

		const result = await runCli(socketPath, ['--output', 'json', 'daemon', 'stop']);
		const envelope = JSON.parse(result.stdout) as {
			ok: boolean;
			data: { stopped: boolean; reason: string };
		};

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(envelope).toMatchObject({
			ok: true,
			data: { stopped: false, reason: 'not_running' },
		});
	});

	it.each(['-1', '1.5', '10ms', '2147483648'])('rejects invalid timeout %s before connecting', async (timeout) => {
		const socketPath = getDisposableSocketPath(testDirectory, `invalid-${timeout}`);

		const result = await runCli(socketPath, ['daemon', 'stop', '--timeout', timeout]);

		expect(result.code).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toContain(`Invalid timeout "${timeout}"`);
	});

	it('returns nonzero for an RPC shutdown failure', async () => {
		const socketPath = getDisposableSocketPath(testDirectory, 'rpc-error');
		const shutdownServer = await createShutdownServer(socketPath, {
			error: { code: -32_000, message: 'Shutdown did not complete' },
		});
		servers.push(shutdownServer);

		const result = await runCli(socketPath, ['--output', 'json', 'daemon', 'stop']);
		const envelope = JSON.parse(result.stdout) as {
			ok: boolean;
			error: { message: string };
		};

		expect(result.code).toBe(1);
		expect(result.stderr).toBe('');
		expect(envelope).toMatchObject({ ok: false, error: { message: 'Shutdown did not complete' } });
	});

	it('returns nonzero when the daemon does not report how it terminated', async () => {
		const socketPath = getDisposableSocketPath(testDirectory, 'invalid-result');
		const shutdownServer = await createShutdownServer(socketPath, { result: { ok: true } });
		servers.push(shutdownServer);

		const result = await runCli(socketPath, ['--output', 'json', 'daemon', 'stop']);
		const envelope = JSON.parse(result.stdout) as {
			ok: boolean;
			error: { message: string };
		};

		expect(result.code).toBe(1);
		expect(result.stderr).toBe('');
		expect(envelope).toMatchObject({
			ok: false,
			error: { message: 'Daemon returned an invalid shutdown result' },
		});
	});
});
