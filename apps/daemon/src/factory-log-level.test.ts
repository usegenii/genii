import { isAbsolute, join, resolve } from 'node:path';
import type { Config } from '@genii/config/config';
import { describe, expect, it } from 'vitest';
import { resolveDaemonDataPath, resolveDaemonLogLevel } from './factory';

function createConfigWithLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): Config {
	return {
		getPreferences: () =>
			({
				logging: { level },
			}) as Config['getPreferences'] extends () => infer T ? T : never,
	} as Config;
}

describe('resolveDaemonLogLevel', () => {
	it('uses CLI log level when provided', () => {
		const config = createConfigWithLogLevel('warn');
		const result = resolveDaemonLogLevel({ logLevel: 'trace', config });
		expect(result).toBe('trace');
	});

	it('uses preferences logging level when CLI log level is not provided', () => {
		const config = createConfigWithLogLevel('warn');
		const result = resolveDaemonLogLevel({ config });
		expect(result).toBe('warn');
	});

	it('defaults to info when neither CLI nor config log level is provided', () => {
		const result = resolveDaemonLogLevel({});
		expect(result).toBe('info');
	});
});

describe('resolveDaemonDataPath', () => {
	it('keeps the daemon data directory authoritative across a different client working directory', () => {
		const relativeDataPath = join('relative-daemon-data', 'genii');
		const daemonDataPath = resolveDaemonDataPath(relativeDataPath);
		const differentClientWorkingDirectory = resolve('different-client-working-directory');

		expect(daemonDataPath).toBe(resolve(relativeDataPath));
		expect(isAbsolute(daemonDataPath)).toBe(true);
		expect(resolve(differentClientWorkingDirectory, daemonDataPath)).toBe(daemonDataPath);
	});
});
