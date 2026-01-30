import { join } from 'node:path';
import { FileSecretStore } from './file.js';
import { KeychainSecretStore } from './keychain.js';
import type { SecretResult, SecretStore } from './types.js';

/**
 * Composite secret store that chains multiple SecretStore implementations.
 * Provides fallback behavior for reads and writes to all stores for redundancy.
 */
export class CompositeSecretStore implements SecretStore {
	private readonly stores: SecretStore[];

	/**
	 * Create a new CompositeSecretStore
	 * @param stores - Array of SecretStore instances to chain (tried in order for reads)
	 */
	constructor(stores: SecretStore[]) {
		this.stores = stores;
	}

	/**
	 * Retrieve a secret by trying each store in order.
	 * Returns the first successful result, or the last error if all fail.
	 * @param name - The name of the secret to retrieve
	 * @returns A SecretResult indicating success with the value, or failure with an error message
	 */
	async get(name: string): Promise<SecretResult> {
		let lastError = `No secret stores configured`;

		for (const store of this.stores) {
			const result = await store.get(name);
			if (result.success) {
				return result;
			}
			lastError = result.error;
		}

		return { success: false, error: lastError };
	}

	/**
	 * Store a secret in all configured stores.
	 * Returns success if at least one store succeeds.
	 * @param name - The name of the secret to store
	 * @param value - The secret value to store
	 * @returns A SecretResult indicating success, or failure with combined error messages
	 */
	async set(name: string, value: string): Promise<SecretResult> {
		const errors: string[] = [];
		let succeeded = false;

		for (const store of this.stores) {
			const result = await store.set(name, value);
			if (result.success) {
				succeeded = true;
			} else {
				errors.push(result.error);
			}
		}

		if (succeeded) {
			return { success: true, value };
		}

		return { success: false, error: errors.join('; ') };
	}
}

/**
 * Create a default secret store with keychain as primary and file as fallback.
 * @param basePath - Base directory path for the file-based fallback storage
 * @param serviceName - Service name for keychain namespace (e.g., 'geniigotchi')
 * @returns A CompositeSecretStore configured with keychain first, then file fallback
 */
export function createDefaultSecretStore(basePath: string, serviceName: string): CompositeSecretStore {
	const keychainStore = new KeychainSecretStore(serviceName);
	const fileStore = new FileSecretStore(join(basePath, 'secrets.json'));

	return new CompositeSecretStore([keychainStore, fileStore]);
}
