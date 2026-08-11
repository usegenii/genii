import { createDaemonClient, getSocketPath } from '../src/client';

interface ClientProbeInput {
	mode: 'onboard-status' | 'ping' | 'resolve';
	socketPath?: string;
}

const input = JSON.parse(process.argv[2] ?? '') as ClientProbeInput;

switch (input.mode) {
	case 'resolve':
		process.stdout.write(getSocketPath());
		break;
	case 'ping': {
		const client = createDaemonClient({
			connectTimeoutMs: 1000,
			requestTimeoutMs: 1000,
			...(input.socketPath === undefined ? {} : { socketPath: input.socketPath }),
		});

		await client.connect();
		try {
			const result = await client.ping();
			if (result.pong !== true) {
				throw new Error('Daemon ping did not return pong');
			}
		} finally {
			await client.disconnect();
		}
		break;
	}
	case 'onboard-status': {
		const client = createDaemonClient({
			connectTimeoutMs: 1000,
			requestTimeoutMs: 1000,
			...(input.socketPath === undefined ? {} : { socketPath: input.socketPath }),
		});

		await client.connect();
		try {
			process.stdout.write(JSON.stringify(await client.onboardStatus()));
		} finally {
			await client.disconnect();
		}
		break;
	}
	default:
		throw new Error('Unknown client probe mode');
}
