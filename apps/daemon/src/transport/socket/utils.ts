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
 * - Unix: /tmp/genii-daemon.sock or XDG_RUNTIME_DIR
 * - Windows: \\.\pipe\genii-daemon
 *
 * @param name - Optional name suffix for the socket
 * @returns The socket path
 */
export function getDefaultSocketPath(name = 'daemon'): string {
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\genii-${name}`;
	}

	// Prefer XDG_RUNTIME_DIR if available (more secure)
	const runtimeDir = process.env.XDG_RUNTIME_DIR;
	if (runtimeDir) {
		return path.join(runtimeDir, `genii-${name}.sock`);
	}

	// Fall back to /tmp
	return `/tmp/genii-${name}.sock`;
}

/**
 * Get the socket path from environment or default.
 *
 * Checks GENII_SOCKET environment variable first.
 *
 * @returns The socket path
 */
export function getSocketPath(): string {
	return process.env.GENII_SOCKET ?? getDefaultSocketPath();
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
 * - Unix: ~/.local/share/genii or XDG_DATA_HOME
 * - macOS: ~/Library/Application Support/genii
 * - Windows: %APPDATA%/genii
 *
 * @returns The data directory path
 */
export function getDataDirectory(): string {
	const home = os.homedir();

	if (process.platform === 'win32') {
		const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
		return path.join(appData, 'genii');
	}

	if (process.platform === 'darwin') {
		return path.join(home, 'Library', 'Application Support', 'genii');
	}

	// Linux/Unix - use XDG_DATA_HOME or default
	const dataHome = process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
	return path.join(dataHome, 'genii');
}

/**
 * Get the log directory.
 *
 * Uses platform-appropriate paths:
 * - Unix: ~/.local/state/genii/logs or XDG_STATE_HOME
 * - macOS: ~/Library/Logs/genii
 * - Windows: %APPDATA%/genii/logs
 *
 * @returns The log directory path
 */
export function getLogDirectory(): string {
	const home = os.homedir();

	if (process.platform === 'win32') {
		const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
		return path.join(appData, 'genii', 'logs');
	}

	if (process.platform === 'darwin') {
		return path.join(home, 'Library', 'Logs', 'genii');
	}

	// Linux/Unix - use XDG_STATE_HOME or default
	const stateHome = process.env.XDG_STATE_HOME ?? path.join(home, '.local', 'state');
	return path.join(stateHome, 'genii', 'logs');
}
