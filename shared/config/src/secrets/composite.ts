import { join } from 'node:path';
import { FileSecretStore } from './file.js';
import { KeychainSecretStore } from './keychain.js';
import type { SecretStore } from './types.js';

/**
 * Check if the native secret store (Keychain/Credential Manager/libsecret) is available.
 * This probes by attempting a read operation - if the backend isn't available, it will throw.
 */
async function isNativeSecretStoreAvailable(serviceName: string): Promise<boolean> {
	try {
		const store = new KeychainSecretStore(serviceName);
		// Try to read a non-existent key - this will fail with "not found" if the store works,
		// or throw an error if the backend isn't available
		const result = await store.get('__probe__');
		// If we get here, the store is available (even if the key wasn't found)
		return result.success || result.error.includes('not found');
	} catch {
		// Backend not available (e.g., no libsecret on headless Linux)
		return false;
	}
}

/**
 * Create a secret store appropriate for the current platform.
 *
 * Platform behavior:
 * - macOS: Uses Keychain (always available)
 * - Windows: Uses Windows Credential Manager (always available)
 * - Linux: Uses libsecret via D-Bus Secret Service if available, otherwise falls back to file
 *
 * @param basePath - Base directory path for file-based fallback storage (used only if native store unavailable)
 * @param serviceName - Service name for native store namespace (e.g., 'geniigotchi')
 * @returns A SecretStore instance appropriate for the platform
 */
export async function createSecretStore(basePath: string, serviceName: string): Promise<SecretStore> {
	// On macOS and Windows, native stores are always available
	// On Linux, we need to check for libsecret/D-Bus Secret Service
	if (process.platform === 'darwin' || process.platform === 'win32') {
		return new KeychainSecretStore(serviceName);
	}

	// Linux or other platforms - check if native store is available
	const nativeAvailable = await isNativeSecretStoreAvailable(serviceName);
	if (nativeAvailable) {
		return new KeychainSecretStore(serviceName);
	}

	// Fall back to file-based storage (headless Linux, containers, CI, etc.)
	return new FileSecretStore(join(basePath, 'secrets.json'));
}
