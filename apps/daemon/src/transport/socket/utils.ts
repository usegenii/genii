/**
 * Platform-specific utilities for socket paths.
 *
 * Handles differences between Unix sockets and Windows named pipes.
 */

import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Get the default socket path for the daemon.
 *
 * Uses platform-appropriate paths:
 * - Unix: /tmp/geniigotchi-daemon.sock or XDG_RUNTIME_DIR
 * - Windows: \\.\pipe\geniigotchi-daemon
 *
 * @param name - Optional name suffix for the socket
 * @returns The socket path
 */
export function getDefaultSocketPath(name = 'daemon'): string {
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\geniigotchi-${name}`;
	}

	// Prefer XDG_RUNTIME_DIR if available (more secure)
	const runtimeDir = process.env.XDG_RUNTIME_DIR;
	if (runtimeDir) {
		return path.join(runtimeDir, `geniigotchi-${name}.sock`);
	}

	// Fall back to /tmp
	return `/tmp/geniigotchi-${name}.sock`;
}

/**
 * Get the socket path from environment or default.
 *
 * Checks GENIIGOTCHI_SOCKET environment variable first.
 *
 * @returns The socket path
 */
export function getSocketPath(): string {
	return process.env.GENIIGOTCHI_SOCKET ?? getDefaultSocketPath();
}

/**
 * Check if we're running on Windows.
 */
export function isWindows(): boolean {
	return process.platform === 'win32';
}

/**
 * Get the data directory for persistent storage.
 *
 * Uses platform-appropriate paths:
 * - Unix: ~/.local/share/geniigotchi or XDG_DATA_HOME
 * - macOS: ~/Library/Application Support/geniigotchi
 * - Windows: %APPDATA%/geniigotchi
 *
 * @returns The data directory path
 */
export function getDataDirectory(): string {
	const home = os.homedir();

	if (process.platform === 'win32') {
		const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
		return path.join(appData, 'geniigotchi');
	}

	if (process.platform === 'darwin') {
		return path.join(home, 'Library', 'Application Support', 'geniigotchi');
	}

	// Linux/Unix - use XDG_DATA_HOME or default
	const dataHome = process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
	return path.join(dataHome, 'geniigotchi');
}

/**
 * Get the log directory.
 *
 * Uses platform-appropriate paths:
 * - Unix: ~/.local/state/geniigotchi/logs or XDG_STATE_HOME
 * - macOS: ~/Library/Logs/geniigotchi
 * - Windows: %APPDATA%/geniigotchi/logs
 *
 * @returns The log directory path
 */
export function getLogDirectory(): string {
	const home = os.homedir();

	if (process.platform === 'win32') {
		const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
		return path.join(appData, 'geniigotchi', 'logs');
	}

	if (process.platform === 'darwin') {
		return path.join(home, 'Library', 'Logs', 'geniigotchi');
	}

	// Linux/Unix - use XDG_STATE_HOME or default
	const stateHome = process.env.XDG_STATE_HOME ?? path.join(home, '.local', 'state');
	return path.join(stateHome, 'geniigotchi', 'logs');
}
