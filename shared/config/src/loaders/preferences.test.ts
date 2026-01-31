import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPreferencesConfig } from './preferences.js';

describe('loadPreferencesConfig - timezone preferences', () => {
	let tempDir: string;

	beforeAll(async () => {
		tempDir = path.join(tmpdir(), `preferences-timezone-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
	});

	afterAll(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('falls back to system timezone when no preferences file exists', async () => {
		const emptyDir = path.join(tempDir, 'no-file');
		await mkdir(emptyDir, { recursive: true });

		const result = await loadPreferencesConfig(emptyDir);

		const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		expect(result.timezone).toBe(systemTimezone);
	});

	it('falls back to system timezone when preferences file has no timezone', async () => {
		const noTimezoneDir = path.join(tempDir, 'no-timezone');
		await mkdir(noTimezoneDir, { recursive: true });

		const tomlContent = `
[agents]
default-models = ["claude-opus"]

[logging]
level = "debug"
`;
		await writeFile(path.join(noTimezoneDir, 'preferences.toml'), tomlContent, 'utf-8');

		const result = await loadPreferencesConfig(noTimezoneDir);

		const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		expect(result.timezone).toBe(systemTimezone);
	});

	it('loads explicit timezone config correctly', async () => {
		const explicitTimezoneDir = path.join(tempDir, 'explicit-timezone');
		await mkdir(explicitTimezoneDir, { recursive: true });

		const tomlContent = `
timezone = "America/New_York"

[agents]
default-models = []

[logging]
level = "info"
`;
		await writeFile(path.join(explicitTimezoneDir, 'preferences.toml'), tomlContent, 'utf-8');

		const result = await loadPreferencesConfig(explicitTimezoneDir);

		expect(result.timezone).toBe('America/New_York');
	});

	it('loads different timezone values correctly', async () => {
		const differentTimezoneDir = path.join(tempDir, 'different-timezone');
		await mkdir(differentTimezoneDir, { recursive: true });

		const tomlContent = `
timezone = "Europe/London"

[agents]
default-models = ["gpt-4"]

[logging]
level = "warn"
`;
		await writeFile(path.join(differentTimezoneDir, 'preferences.toml'), tomlContent, 'utf-8');

		const result = await loadPreferencesConfig(differentTimezoneDir);

		expect(result.timezone).toBe('Europe/London');
	});

	it('loads UTC timezone correctly', async () => {
		const utcTimezoneDir = path.join(tempDir, 'utc-timezone');
		await mkdir(utcTimezoneDir, { recursive: true });

		const tomlContent = `
timezone = "UTC"

[agents]
default-models = []

[logging]
level = "info"
`;
		await writeFile(path.join(utcTimezoneDir, 'preferences.toml'), tomlContent, 'utf-8');

		const result = await loadPreferencesConfig(utcTimezoneDir);

		expect(result.timezone).toBe('UTC');
	});

	it('preserves timezone when merging with other preferences', async () => {
		const mergeDir = path.join(tempDir, 'merge-timezone');
		await mkdir(mergeDir, { recursive: true });

		const tomlContent = `
timezone = "Asia/Tokyo"

[agents]
default-models = ["claude-opus", "gpt-4"]

[agents.tools.shell]
default-timeout = 60000

[logging]
level = "debug"
`;
		await writeFile(path.join(mergeDir, 'preferences.toml'), tomlContent, 'utf-8');

		const result = await loadPreferencesConfig(mergeDir);

		expect(result.timezone).toBe('Asia/Tokyo');
		expect(result.agents.defaultModels).toEqual(['claude-opus', 'gpt-4']);
		expect(result.agents.tools?.shell?.defaultTimeout).toBe(60000);
		expect(result.logging.level).toBe('debug');
	});
});
