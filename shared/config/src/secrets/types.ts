/**
 * Result type for secret operations - discriminated union for success/failure
 */
export type SecretResult = { success: true; value: string } | { success: false; error: string };

/**
 * Interface for secret storage backends
 */
export interface SecretStore {
	/**
	 * Retrieve a secret by name
	 */
	get(name: string): Promise<SecretResult>;

	/**
	 * Store a secret with the given name and value
	 */
	set(name: string, value: string): Promise<SecretResult>;
}
