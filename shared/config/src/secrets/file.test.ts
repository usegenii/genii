import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CompositeSecretStore } from './composite.js';
import { FileSecretStore } from './file.js';
import type { SecretStore } from './types.js';

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

describe('CompositeSecretStore', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'composite-secret-store-test-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe('get with fallback', () => {
		it('returns value from first store that has the secret', async () => {
			const store1Path = join(tempDir, 'store1', 'secrets.json');
			const store2Path = join(tempDir, 'store2', 'secrets.json');

			const store1 = new FileSecretStore(store1Path);
			const store2 = new FileSecretStore(store2Path);

			await store1.set('key', 'value-from-store1');
			await store2.set('key', 'value-from-store2');

			const composite = new CompositeSecretStore([store1, store2]);
			const result = await composite.get('key');

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.value).toBe('value-from-store1');
			}
		});

		it('falls back to second store if first does not have the secret', async () => {
			const store1Path = join(tempDir, 'store1', 'secrets.json');
			const store2Path = join(tempDir, 'store2', 'secrets.json');

			const store1 = new FileSecretStore(store1Path);
			const store2 = new FileSecretStore(store2Path);

			await store2.set('key', 'value-from-store2');

			const composite = new CompositeSecretStore([store1, store2]);
			const result = await composite.get('key');

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.value).toBe('value-from-store2');
			}
		});

		it('returns error if no stores have the secret', async () => {
			const store1Path = join(tempDir, 'store1', 'secrets.json');
			const store2Path = join(tempDir, 'store2', 'secrets.json');

			const store1 = new FileSecretStore(store1Path);
			const store2 = new FileSecretStore(store2Path);

			const composite = new CompositeSecretStore([store1, store2]);
			const result = await composite.get('missing');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe("Secret 'missing' not found");
			}
		});

		it('returns error when no stores are configured', async () => {
			const composite = new CompositeSecretStore([]);
			const result = await composite.get('key');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('No secret stores configured');
			}
		});
	});

	describe('set to all stores', () => {
		it('writes to all stores and returns success', async () => {
			const store1Path = join(tempDir, 'store1', 'secrets.json');
			const store2Path = join(tempDir, 'store2', 'secrets.json');

			const store1 = new FileSecretStore(store1Path);
			const store2 = new FileSecretStore(store2Path);

			const composite = new CompositeSecretStore([store1, store2]);
			const setResult = await composite.set('key', 'value');

			expect(setResult.success).toBe(true);

			const result1 = await store1.get('key');
			const result2 = await store2.get('key');

			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);
			if (result1.success && result2.success) {
				expect(result1.value).toBe('value');
				expect(result2.value).toBe('value');
			}
		});

		it('returns success if at least one store succeeds', async () => {
			const validPath = join(tempDir, 'valid', 'secrets.json');
			const validStore = new FileSecretStore(validPath);

			const failingStore: SecretStore = {
				get: async () => ({ success: false, error: 'Always fails' }),
				set: async () => ({ success: false, error: 'Always fails' }),
			};

			const composite = new CompositeSecretStore([failingStore, validStore]);
			const result = await composite.set('key', 'value');

			expect(result.success).toBe(true);

			const getResult = await validStore.get('key');
			expect(getResult.success).toBe(true);
		});

		it('returns combined errors if all stores fail', async () => {
			const failingStore1: SecretStore = {
				get: async () => ({ success: false, error: 'Error 1' }),
				set: async () => ({ success: false, error: 'Error 1' }),
			};

			const failingStore2: SecretStore = {
				get: async () => ({ success: false, error: 'Error 2' }),
				set: async () => ({ success: false, error: 'Error 2' }),
			};

			const composite = new CompositeSecretStore([failingStore1, failingStore2]);
			const result = await composite.set('key', 'value');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('Error 1; Error 2');
			}
		});
	});
});
