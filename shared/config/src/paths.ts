import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Get the default base path for genii data/config files.
 *
 * Uses platform-appropriate paths:
 * - macOS: ~/Library/Application Support/genii
 * - Windows: %APPDATA%/genii
 * - Linux/Unix: $XDG_DATA_HOME/genii or ~/.local/share/genii
 */
export function getDefaultBasePath(): string {
	const home = homedir();
	if (process.platform === 'darwin') {
		return join(home, 'Library', 'Application Support', 'genii');
	}
	if (process.platform === 'win32') {
		return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'genii');
	}
	return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'genii');
}
