import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretResult, SecretStore } from './types.js';

/**
 * File-based secret storage implementation.
 * Stores secrets in a JSON file with restricted permissions (0600).
 */
export class FileSecretStore implements SecretStore {
	private readonly filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	/**
	 * Retrieve a secret by name from the JSON file
	 */
	async get(name: string): Promise<SecretResult> {
		try {
			const secrets = await this.readSecrets();
			if (secrets === null) {
				return { success: false, error: 'Failed to parse secrets file: malformed JSON' };
			}

			const value = secrets[name];
			if (value === undefined) {
				return { success: false, error: `Secret '${name}' not found` };
			}

			return { success: true, value };
		} catch (error) {
			if (this.isNodeError(error) && error.code === 'ENOENT') {
				return { success: false, error: `Secret '${name}' not found` };
			}
			return { success: false, error: `Failed to read secrets: ${this.getErrorMessage(error)}` };
		}
	}

	/**
	 * Store a secret with the given name and value
	 */
	async set(name: string, value: string): Promise<SecretResult> {
		try {
			// Ensure directory exists with 0700 permissions
			const dir = dirname(this.filePath);
			await mkdir(dir, { recursive: true, mode: 0o700 });

			// Read existing secrets or start with empty object
			let secrets: Record<string, string> = {};
			try {
				const existing = await this.readSecrets();
				if (existing === null) {
					return { success: false, error: 'Failed to parse existing secrets file: malformed JSON' };
				}
				secrets = existing;
			} catch (error) {
				if (!(this.isNodeError(error) && error.code === 'ENOENT')) {
					throw error;
				}
				// File doesn't exist yet, start with empty object
			}

			// Update the secret
			secrets[name] = value;

			// Write back with 0600 permissions
			await writeFile(this.filePath, JSON.stringify(secrets, null, '\t'), {
				mode: 0o600,
				encoding: 'utf-8',
			});

			return { success: true, value };
		} catch (error) {
			return { success: false, error: `Failed to write secret: ${this.getErrorMessage(error)}` };
		}
	}

	/**
	 * Read and parse the secrets file
	 * Returns null if JSON is malformed, throws for other errors
	 */
	private async readSecrets(): Promise<Record<string, string> | null> {
		const content = await readFile(this.filePath, 'utf-8');
		try {
			return JSON.parse(content) as Record<string, string>;
		} catch {
			return null;
		}
	}

	/**
	 * Type guard for Node.js errors with code property
	 */
	private isNodeError(error: unknown): error is NodeJS.ErrnoException {
		return error instanceof Error && 'code' in error;
	}

	/**
	 * Extract error message from unknown error type
	 */
	private getErrorMessage(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}
		return String(error);
	}
}
