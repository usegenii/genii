import { chmod, type FileHandle, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSecretStore } from './file.js';

const supportsPosixPermissions = typeof process.getuid === 'function';

interface TestableFileSecretStore {
	closeFile(file: FileHandle | undefined): Promise<unknown | undefined>;
}

async function getMode(path: string): Promise<number> {
	return (await lstat(path)).mode & 0o7777;
}

describe('FileSecretStore', () => {
	let tempDir: string;
	let secretsPath: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'file-secret-store-test-'));
		secretsPath = join(tempDir, 'secrets.json');
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe('set and get', () => {
		it('can set and get a secret', async () => {
			const store = new FileSecretStore(secretsPath);

			const setResult = await store.set('api-key', 'my-secret-value');
			expect(setResult.success).toBe(true);
			if (setResult.success) {
				expect(setResult.value).toBe('my-secret-value');
			}

			const getResult = await store.get('api-key');
			expect(getResult.success).toBe(true);
			if (getResult.success) {
				expect(getResult.value).toBe('my-secret-value');
			}
		});

		it('can set multiple secrets', async () => {
			const store = new FileSecretStore(secretsPath);

			await store.set('key1', 'value1');
			await store.set('key2', 'value2');

			const result1 = await store.get('key1');
			const result2 = await store.get('key2');

			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);
			if (result1.success && result2.success) {
				expect(result1.value).toBe('value1');
				expect(result2.value).toBe('value2');
			}
		});

		it('overwrites existing secret with same name', async () => {
			const store = new FileSecretStore(secretsPath);

			await store.set('key', 'original');
			await store.set('key', 'updated');

			const result = await store.get('key');
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.value).toBe('updated');
			}
		});
	});

	describe('close failure handling', () => {
		it('captures a rejecting file-handle close', async () => {
			const closeError = new Error('simulated secrets file close failure');
			const file = { close: vi.fn().mockRejectedValue(closeError) } as unknown as FileHandle;
			const store = new FileSecretStore(secretsPath) as unknown as TestableFileSecretStore;

			await expect(store.closeFile(file)).resolves.toBe(closeError);
		});

		it('returns a read error when the final secrets file close fails', async () => {
			await writeFile(secretsPath, JSON.stringify({ key: 'value' }), { encoding: 'utf-8', mode: 0o600 });
			const store = new FileSecretStore(secretsPath);
			const testableStore = store as unknown as TestableFileSecretStore;
			const originalCloseFile = testableStore.closeFile.bind(store);
			const closeSpy = vi.spyOn(testableStore, 'closeFile').mockImplementation(async (file) => {
				const closeError = await originalCloseFile(file);
				return closeError ?? new Error('simulated secrets file close failure');
			});

			try {
				const result = await store.get('key');

				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.error).toContain('Failed to read secrets:');
					expect(result.error).toContain('simulated secrets file close failure');
				}
				expect(closeSpy).toHaveBeenCalledTimes(1);
			} finally {
				closeSpy.mockRestore();
			}
		});

		it('returns a write error when the final secrets file close fails', async () => {
			const store = new FileSecretStore(secretsPath);
			const testableStore = store as unknown as TestableFileSecretStore;
			const originalCloseFile = testableStore.closeFile.bind(store);
			const closeSpy = vi.spyOn(testableStore, 'closeFile').mockImplementation(async (file) => {
				const closeError = await originalCloseFile(file);
				return closeError ?? new Error('simulated secrets file close failure');
			});

			try {
				const result = await store.set('key', 'value');

				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.error).toContain('Failed to write secret:');
					expect(result.error).toContain('simulated secrets file close failure');
				}
				expect(closeSpy).toHaveBeenCalledTimes(1);
			} finally {
				closeSpy.mockRestore();
			}
		});
	});

	describe('get non-existent secret', () => {
		it('returns error for non-existent secret when file does not exist', async () => {
			const store = new FileSecretStore(secretsPath);

			const result = await store.get('missing-key');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe("Secret 'missing-key' not found");
			}
		});

		it('returns error for non-existent secret when file exists', async () => {
			const store = new FileSecretStore(secretsPath);

			await store.set('existing-key', 'value');
			const result = await store.get('missing-key');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe("Secret 'missing-key' not found");
			}
		});
	});

	describe('directory and file creation', () => {
		it('creates directory and file if they do not exist', async () => {
			const nestedPath = join(tempDir, 'nested', 'deep', 'secrets.json');
			const store = new FileSecretStore(nestedPath);

			const result = await store.set('key', 'value');

			expect(result.success).toBe(true);

			const getResult = await store.get('key');
			expect(getResult.success).toBe(true);
			if (getResult.success) {
				expect(getResult.value).toBe('value');
			}
		});

		it.skipIf(!supportsPosixPermissions)(
			'creates the data directory and secrets file with secure modes',
			async () => {
				const nestedPath = join(tempDir, 'nested', 'deep', 'secrets.json');
				const store = new FileSecretStore(nestedPath);

				const result = await store.set('key', 'value');

				expect(result.success).toBe(true);
				expect(await getMode(dirname(nestedPath))).toBe(0o700);
				expect(await getMode(nestedPath)).toBe(0o600);
			},
		);
	});

	describe.skipIf(!supportsPosixPermissions)('POSIX ownership and permissions', () => {
		it('reads from secure permission subsets without changing existing modes', async () => {
			await writeFile(secretsPath, JSON.stringify({ key: 'value' }), { encoding: 'utf-8', mode: 0o600 });
			await chmod(secretsPath, 0o400);

			try {
				await chmod(tempDir, 0o500);

				const result = await new FileSecretStore(secretsPath).get('key');

				expect(result).toEqual({ success: true, value: 'value' });
				expect(await getMode(tempDir)).toBe(0o500);
				expect(await getMode(secretsPath)).toBe(0o400);
			} finally {
				await chmod(tempDir, 0o700);
			}
		});

		it('reads through an execute-only secure data directory without changing existing modes', async () => {
			await writeFile(secretsPath, JSON.stringify({ key: 'value' }), { encoding: 'utf-8', mode: 0o600 });
			await chmod(secretsPath, 0o400);

			try {
				await chmod(tempDir, 0o100);

				const result = await new FileSecretStore(secretsPath).get('key');

				expect(result).toEqual({ success: true, value: 'value' });
				expect(await getMode(tempDir)).toBe(0o100);
				expect(await getMode(secretsPath)).toBe(0o400);
			} finally {
				await chmod(tempDir, 0o700);
			}
		});

		it('writes through a secure directory permission subset without changing existing modes', async () => {
			await writeFile(secretsPath, JSON.stringify({ existing: 'original' }), {
				encoding: 'utf-8',
				mode: 0o600,
			});

			try {
				await chmod(tempDir, 0o500);

				const result = await new FileSecretStore(secretsPath).set('added', 'new-value');

				expect(result).toEqual({ success: true, value: 'new-value' });
				expect(JSON.parse(await readFile(secretsPath, 'utf-8'))).toEqual({
					existing: 'original',
					added: 'new-value',
				});
				expect(await getMode(tempDir)).toBe(0o500);
				expect(await getMode(secretsPath)).toBe(0o600);
			} finally {
				await chmod(tempDir, 0o700);
			}
		});

		it('returns actionable guidance when a secure existing directory cannot create the secrets file', async () => {
			try {
				await chmod(tempDir, 0o500);

				const result = await new FileSecretStore(secretsPath).set('key', 'value');

				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.error).toContain('Failed to write secret:');
					expect(result.error).toContain(tempDir);
					expect(result.error).toMatch(/chmod.*0700|owner.*write.*execute/i);
				}
				expect(await getMode(tempDir)).toBe(0o500);
				await expect(lstat(secretsPath)).rejects.toMatchObject({ code: 'ENOENT' });
			} finally {
				await chmod(tempDir, 0o700);
			}
		});

		it.each([
			{ mode: 0o755, formattedMode: '0755' },
			{ mode: 0o077, formattedMode: '0077' },
		])('rejects data-directory mode $formattedMode without changing it', async ({ mode, formattedMode }) => {
			await writeFile(secretsPath, JSON.stringify({ key: 'value' }), { encoding: 'utf-8', mode: 0o600 });

			try {
				await chmod(tempDir, mode);
				const result = await new FileSecretStore(secretsPath).get('key');

				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.error).toContain('Failed to read secrets:');
					expect(result.error).toContain(tempDir);
					expect(result.error).toContain(formattedMode);
					expect(result.error).toContain('0700');
					expect(result.error).toContain('chmod');
				}
				expect(await getMode(tempDir)).toBe(mode);
			} finally {
				await chmod(tempDir, 0o700);
			}
			expect(await getMode(secretsPath)).toBe(0o600);
		});

		it.each([
			{ mode: 0o644, formattedMode: '0644' },
			{ mode: 0o044, formattedMode: '0044' },
		])(
			'rejects secrets-file mode $formattedMode without changing it or its contents',
			async ({ mode, formattedMode }) => {
				const originalContent = JSON.stringify({ key: 'value' });
				await writeFile(secretsPath, originalContent, { encoding: 'utf-8', mode: 0o600 });
				await chmod(secretsPath, mode);

				const store = new FileSecretStore(secretsPath);
				const getResult = await store.get('key');
				const setResult = await store.set('key', 'replacement');

				expect(getResult.success).toBe(false);
				if (!getResult.success) {
					expect(getResult.error).toContain('Failed to read secrets:');
					expect(getResult.error).toContain(secretsPath);
					expect(getResult.error).toContain(formattedMode);
					expect(getResult.error).toContain('0600');
					expect(getResult.error).toContain('chmod');
				}
				expect(setResult.success).toBe(false);
				if (!setResult.success) {
					expect(setResult.error).toContain('Failed to write secret:');
					expect(setResult.error).toContain(secretsPath);
					expect(setResult.error).toContain(formattedMode);
					expect(setResult.error).toContain('0600');
					expect(setResult.error).toContain('chmod');
				}
				expect(await getMode(secretsPath)).toBe(mode);
				await chmod(secretsPath, 0o600);
				expect(await readFile(secretsPath, 'utf-8')).toBe(originalContent);
			},
		);

		it('rejects special permission bits on the data directory without changing its mode', async () => {
			await writeFile(secretsPath, JSON.stringify({ key: 'value' }), { encoding: 'utf-8', mode: 0o600 });
			await chmod(tempDir, 0o1700);

			const result = await new FileSecretStore(secretsPath).get('key');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Failed to read secrets:');
				expect(result.error).toContain(tempDir);
				expect(result.error).toContain('01700');
				expect(result.error).toContain('0700');
				expect(result.error).toContain('chmod');
			}
			expect(await getMode(tempDir)).toBe(0o1700);
		});

		it('rejects special permission bits on the secrets file without changing its mode', async () => {
			await writeFile(secretsPath, JSON.stringify({ key: 'value' }), { encoding: 'utf-8', mode: 0o600 });
			await chmod(secretsPath, 0o4600);

			const result = await new FileSecretStore(secretsPath).get('key');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Failed to read secrets:');
				expect(result.error).toContain(secretsPath);
				expect(result.error).toContain('04600');
				expect(result.error).toContain('0600');
				expect(result.error).toContain('chmod');
			}
			expect(await getMode(secretsPath)).toBe(0o4600);
		});

		it('fails closed without repairing a store not owned by the current user', async () => {
			await writeFile(secretsPath, JSON.stringify({ key: 'value' }), { encoding: 'utf-8', mode: 0o600 });
			await chmod(tempDir, 0o700);

			const posixProcess = process as NodeJS.Process & { getuid(): number };
			const currentUid = posixProcess.getuid();
			const getuidSpy = vi.spyOn(posixProcess, 'getuid').mockReturnValue(currentUid + 1);
			try {
				const result = await new FileSecretStore(secretsPath).get('key');

				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.error).toContain('Failed to read secrets:');
					expect(result.error).toContain(tempDir);
					expect(result.error).toContain('must be owned by the current user');
					expect(result.error).toContain(`expected uid ${currentUid + 1}`);
					expect(result.error).toContain(`found uid ${currentUid}`);
					expect(result.error).toContain('Change its ownership');
				}
				expect(await getMode(tempDir)).toBe(0o700);
			} finally {
				getuidSpy.mockRestore();
			}
		});

		it('rejects a symlinked secrets file without reading or modifying its target', async () => {
			const targetPath = join(tempDir, 'target.json');
			const targetContent = JSON.stringify({ key: 'target-value' });
			await writeFile(targetPath, targetContent, { encoding: 'utf-8', mode: 0o600 });
			await chmod(targetPath, 0o600);
			await symlink(targetPath, secretsPath);

			const store = new FileSecretStore(secretsPath);
			const getResult = await store.get('key');
			const setResult = await store.set('key', 'replacement');

			expect(getResult.success).toBe(false);
			if (!getResult.success) {
				expect(getResult.error).toContain('Failed to read secrets:');
				expect(getResult.error).toContain(secretsPath);
				expect(getResult.error).toContain('must not be a symbolic link');
			}
			expect(setResult.success).toBe(false);
			if (!setResult.success) {
				expect(setResult.error).toContain('Failed to write secret:');
				expect(setResult.error).toContain(secretsPath);
				expect(setResult.error).toContain('must not be a symbolic link');
			}
			expect(await readFile(targetPath, 'utf-8')).toBe(targetContent);
			expect(await getMode(targetPath)).toBe(0o600);
		});

		it('rejects a symlinked data directory', async () => {
			const targetDir = join(tempDir, 'target');
			const linkedDir = join(tempDir, 'linked');
			await mkdir(targetDir, { mode: 0o700 });
			await chmod(targetDir, 0o700);
			await writeFile(join(targetDir, 'secrets.json'), JSON.stringify({ key: 'target-value' }), {
				encoding: 'utf-8',
				mode: 0o600,
			});
			await symlink(targetDir, linkedDir);

			const result = await new FileSecretStore(join(linkedDir, 'secrets.json')).get('key');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Failed to read secrets:');
				expect(result.error).toContain(linkedDir);
				expect(result.error).toContain('must not be a symbolic link');
			}
		});

		it('rejects a directory in place of the secrets file', async () => {
			await mkdir(secretsPath, { mode: 0o700 });
			await chmod(secretsPath, 0o700);

			const result = await new FileSecretStore(secretsPath).get('key');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Failed to read secrets:');
				expect(result.error).toContain(secretsPath);
				expect(result.error).toContain('must be a regular file');
			}
		});

		it('rejects a file in place of the data directory', async () => {
			const dataPath = join(tempDir, 'not-a-directory');
			await writeFile(dataPath, 'not a directory', { encoding: 'utf-8', mode: 0o600 });

			const result = await new FileSecretStore(join(dataPath, 'secrets.json')).get('key');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Failed to read secrets:');
				expect(result.error).toContain(dataPath);
				expect(result.error).toContain('must be a directory');
			}
		});
	});

	describe('malformed JSON handling', () => {
		it('returns error when reading from malformed JSON file', async () => {
			const store = new FileSecretStore(secretsPath);

			await mkdir(tempDir, { recursive: true });
			await writeFile(secretsPath, 'not valid json {{{', { encoding: 'utf-8', mode: 0o600 });

			const result = await store.get('key');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('Failed to parse secrets file: malformed JSON');
			}
		});

		it('returns error when setting to file with malformed JSON', async () => {
			const store = new FileSecretStore(secretsPath);

			await mkdir(tempDir, { recursive: true });
			await writeFile(secretsPath, 'not valid json {{{', { encoding: 'utf-8', mode: 0o600 });

			const result = await store.set('key', 'value');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('Failed to parse existing secrets file: malformed JSON');
			}
		});
	});
});
