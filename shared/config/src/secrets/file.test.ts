import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSecretStore } from './file.js';

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
	});

	describe('malformed JSON handling', () => {
		it('returns error when reading from malformed JSON file', async () => {
			const store = new FileSecretStore(secretsPath);

			await mkdir(tempDir, { recursive: true });
			await writeFile(secretsPath, 'not valid json {{{', 'utf-8');

			const result = await store.get('key');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('Failed to parse secrets file: malformed JSON');
			}
		});

		it('returns error when setting to file with malformed JSON', async () => {
			const store = new FileSecretStore(secretsPath);

			await mkdir(tempDir, { recursive: true });
			await writeFile(secretsPath, 'not valid json {{{', 'utf-8');

			const result = await store.set('key', 'value');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('Failed to parse existing secrets file: malformed JSON');
			}
		});
	});
});
