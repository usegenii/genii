import type { Config } from '@genii/config/config';
import { describe, expect, it } from 'vitest';
import { resolveDaemonLogLevel } from './factory';

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
