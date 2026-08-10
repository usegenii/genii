import { createDaemonClient, getSocketPath } from '../client';

interface ClientProbeInput {
	mode: 'ping' | 'resolve';
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
	default:
		throw new Error('Unknown client probe mode');
}
