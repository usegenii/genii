import { Entry } from '@napi-rs/keyring';
import type { SecretResult, SecretStore } from './types.js';

/**
 * Secret store implementation using the system keychain via @napi-rs/keyring
 */
export class KeychainSecretStore implements SecretStore {
	private readonly serviceName: string;

	/**
	 * Create a new KeychainSecretStore
	 * @param serviceName - The service name used to namespace secrets in the keychain (e.g., 'geniigotchi')
	 */
	constructor(serviceName: string) {
		this.serviceName = serviceName;
	}

	/**
	 * Retrieve a secret from the system keychain
	 * @param name - The name of the secret to retrieve
	 * @returns A SecretResult indicating success with the value, or failure with an error message
	 */
	async get(name: string): Promise<SecretResult> {
		try {
			const entry = new Entry(this.serviceName, name);
			const value = entry.getPassword();
			if (value === null) {
				return { success: false, error: `Secret '${name}' not found in keychain` };
			}
			return { success: true, value };
		} catch (error) {
			return { success: false, error: this.formatError(error, 'retrieve', name) };
		}
	}

	/**
	 * Store a secret in the system keychain
	 * @param name - The name of the secret to store
	 * @param value - The secret value to store
	 * @returns A SecretResult indicating success, or failure with an error message
	 */
	async set(name: string, value: string): Promise<SecretResult> {
		try {
			const entry = new Entry(this.serviceName, name);
			entry.setPassword(value);
			return { success: true, value };
		} catch (error) {
			return { success: false, error: this.formatError(error, 'store', name) };
		}
	}

	/**
	 * Format error messages from keychain operations
	 */
	private formatError(error: unknown, operation: string, secretName: string): string {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const lowerMessage = errorMessage.toLowerCase();

		// Handle common keychain error cases
		if (lowerMessage.includes('not found') || lowerMessage.includes('no password')) {
			return `Secret '${secretName}' not found in keychain`;
		}

		if (lowerMessage.includes('denied') || lowerMessage.includes('permission') || lowerMessage.includes('access')) {
			return `Permission denied: unable to ${operation} secret '${secretName}' in keychain`;
		}

		if (
			lowerMessage.includes('unavailable') ||
			lowerMessage.includes('not available') ||
			lowerMessage.includes('no keychain')
		) {
			return `System keychain is not available`;
		}

		return `Failed to ${operation} secret '${secretName}': ${errorMessage}`;
	}
}
