import { constants, type Stats } from 'node:fs';
import { chmod, type FileHandle, lstat, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretResult, SecretStore } from './types.js';

const DIRECTORY_MODE = 0o700;
const SECRET_FILE_MODE = 0o600;
const POSIX_MODE_MASK = 0o7777;

type SecurePathKind = 'directory' | 'file';

interface OpenSecretFile {
	handle: FileHandle;
	created: boolean;
}

/**
 * File-based secret storage implementation.
 * Stores secrets in a JSON file owned by the current user with restricted permissions (0600).
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
		let file: FileHandle | undefined;
		let result: SecretResult;
		try {
			await this.secureDirectory(false);
			file = await this.openSecureExistingFile(false);

			const secrets = await this.readSecrets(file);
			if (secrets === null) {
				result = { success: false, error: 'Failed to parse secrets file: malformed JSON' };
			} else {
				const value = secrets[name];
				result =
					value === undefined
						? { success: false, error: `Secret '${name}' not found` }
						: { success: true, value };
			}
		} catch (error) {
			if (this.isNodeError(error) && error.code === 'ENOENT') {
				result = { success: false, error: `Secret '${name}' not found` };
			} else {
				result = { success: false, error: `Failed to read secrets: ${this.getErrorMessage(error)}` };
			}
		}

		const closeError = await this.closeFile(file);
		if (closeError !== undefined && result.success) {
			return {
				success: false,
				error: `Failed to read secrets: Unable to close secrets file '${this.filePath}': ${this.getErrorMessage(closeError)}`,
			};
		}
		return result;
	}

	/**
	 * Store a secret with the given name and value
	 */
	async set(name: string, value: string): Promise<SecretResult> {
		let file: FileHandle | undefined;
		let result: SecretResult;
		try {
			await this.secureDirectory(true);
			const openedFile = await this.openSecureFileForWrite();
			file = openedFile.handle;

			const secrets = openedFile.created ? {} : await this.readSecrets(file);
			if (secrets === null) {
				result = { success: false, error: 'Failed to parse existing secrets file: malformed JSON' };
			} else {
				secrets[name] = value;
				await this.replaceContents(file, JSON.stringify(secrets, null, '\t'));
				await this.secureHandle(file, 'Secrets file', this.filePath, 'file', SECRET_FILE_MODE);
				await this.secureDirectory(false);

				result = { success: true, value };
			}
		} catch (error) {
			result = { success: false, error: `Failed to write secret: ${this.getErrorMessage(error)}` };
		}

		const closeError = await this.closeFile(file);
		if (closeError !== undefined && result.success) {
			return {
				success: false,
				error: `Failed to write secret: Unable to close secrets file '${this.filePath}': ${this.getErrorMessage(closeError)}`,
			};
		}
		return result;
	}

	/**
	 * Ensure the containing data directory is a real, current-user-owned 0700 directory on POSIX.
	 */
	private async secureDirectory(create: boolean): Promise<void> {
		const directoryPath = dirname(this.filePath);
		if (create) {
			try {
				await mkdir(directoryPath, { recursive: true, mode: DIRECTORY_MODE });
			} catch (error) {
				if (!(this.isNodeError(error) && error.code === 'EEXIST')) {
					throw error;
				}
			}
		}

		const pathStats = await lstat(directoryPath);
		this.validatePath(pathStats, 'Secret data directory', directoryPath, 'directory');

		if (!this.usesPosixPermissions()) {
			return;
		}

		let directory: FileHandle | undefined;
		try {
			directory = await this.openPathWithRepair(
				pathStats,
				'Secret data directory',
				directoryPath,
				'directory',
				DIRECTORY_MODE,
				constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
			);
			await this.secureHandle(directory, 'Secret data directory', directoryPath, 'directory', DIRECTORY_MODE);
		} catch (error) {
			if (this.isNodeError(error) && (error.code === 'ELOOP' || error.code === 'EMLINK')) {
				throw this.symbolicLinkError('Secret data directory', directoryPath, 'directory');
			}
			throw error;
		} finally {
			await directory?.close();
		}
	}

	/**
	 * Open an existing file securely. Writable opens retain the validated inode and never truncate before validation.
	 */
	private async openSecureExistingFile(writable: boolean): Promise<FileHandle> {
		const readOnlyFile = await this.openAndSecureExistingFile(constants.O_RDONLY);
		if (!writable) {
			return readOnlyFile.handle;
		}

		let writableFile: { handle: FileHandle; stats: Stats } | undefined;
		try {
			writableFile = await this.openAndSecureExistingFile(constants.O_RDWR);
			if (
				readOnlyFile.stats.dev !== writableFile.stats.dev ||
				readOnlyFile.stats.ino !== writableFile.stats.ino
			) {
				throw new Error(
					`Secrets file '${this.filePath}' changed while it was being secured. Retry the operation.`,
				);
			}

			await readOnlyFile.handle.close();
			return writableFile.handle;
		} catch (error) {
			await readOnlyFile.handle.close();
			await writableFile?.handle.close();
			throw error;
		}
	}

	/**
	 * Open a new or existing file for writing without following a final-component symlink on POSIX.
	 */
	private async openSecureFileForWrite(): Promise<OpenSecretFile> {
		if (await this.pathExists(this.filePath)) {
			return { handle: await this.openSecureExistingFile(true), created: false };
		}

		let file: FileHandle | undefined;
		try {
			file = await open(
				this.filePath,
				this.secureFileFlags(constants.O_CREAT | constants.O_EXCL | constants.O_RDWR),
				SECRET_FILE_MODE,
			);
			await this.secureHandle(file, 'Secrets file', this.filePath, 'file', SECRET_FILE_MODE);
			return { handle: file, created: true };
		} catch (error) {
			await file?.close();
			if (this.isNodeError(error) && error.code === 'EEXIST') {
				return { handle: await this.openSecureExistingFile(true), created: false };
			}
			throw error;
		}
	}

	/**
	 * Validate a path before opening it, then validate and repair the opened file handle.
	 */
	private async openAndSecureExistingFile(flags: number): Promise<{ handle: FileHandle; stats: Stats }> {
		const pathStats = await lstat(this.filePath);
		this.validatePath(pathStats, 'Secrets file', this.filePath, 'file');

		let file: FileHandle | undefined;
		try {
			file = await this.openPathWithRepair(
				pathStats,
				'Secrets file',
				this.filePath,
				'file',
				SECRET_FILE_MODE,
				this.secureFileFlags(flags),
			);
			const stats = await this.secureHandle(file, 'Secrets file', this.filePath, 'file', SECRET_FILE_MODE);
			return { handle: file, stats };
		} catch (error) {
			await file?.close();
			if (this.isNodeError(error) && (error.code === 'ELOOP' || error.code === 'EMLINK')) {
				throw this.symbolicLinkError('Secrets file', this.filePath, 'file');
			}
			throw error;
		}
	}

	/**
	 * Validate ownership and type, repair the mode when safe, then verify the resulting metadata.
	 */
	private async secureHandle(
		handle: FileHandle,
		label: string,
		path: string,
		kind: SecurePathKind,
		expectedMode: number,
	): Promise<Stats> {
		let stats = await handle.stat();
		this.validatePath(stats, label, path, kind);

		if (!this.usesPosixPermissions()) {
			return stats;
		}

		if ((stats.mode & POSIX_MODE_MASK) !== expectedMode) {
			try {
				await handle.chmod(expectedMode);
			} catch (error) {
				throw new Error(
					`Unable to secure ${label.toLowerCase()} '${path}' with mode ${this.formatMode(expectedMode)}: ${this.getErrorMessage(error)}. Set the required mode and retry.`,
				);
			}
		}

		stats = await handle.stat();
		this.validatePath(stats, label, path, kind);
		const actualMode = stats.mode & POSIX_MODE_MASK;
		if (actualMode !== expectedMode) {
			throw new Error(
				`${label} '${path}' must use mode ${this.formatMode(expectedMode)}, but mode ${this.formatMode(actualMode)} remains after repair. Set the required mode and retry.`,
			);
		}

		return stats;
	}

	/**
	 * Open a validated path, repairing its mode by path only when its current mode prevents a handle-based repair.
	 */
	private async openPathWithRepair(
		pathStats: Stats,
		label: string,
		path: string,
		kind: SecurePathKind,
		expectedMode: number,
		flags: number,
	): Promise<FileHandle> {
		try {
			return await open(path, flags);
		} catch (error) {
			if (this.isSymbolicLinkError(error)) {
				throw this.symbolicLinkError(label, path, kind);
			}
			if (
				!this.usesPosixPermissions() ||
				!this.isAccessError(error) ||
				(pathStats.mode & POSIX_MODE_MASK) === expectedMode
			) {
				if (this.isAccessError(error)) {
					throw this.accessError(label, path, expectedMode, error);
				}
				throw error;
			}

			await this.repairModeByPath(pathStats, label, path, kind, expectedMode);
			try {
				return await open(path, flags);
			} catch (retryError) {
				if (this.isSymbolicLinkError(retryError)) {
					throw this.symbolicLinkError(label, path, kind);
				}
				if (this.isAccessError(retryError)) {
					throw this.accessError(label, path, expectedMode, retryError);
				}
				throw retryError;
			}
		}
	}

	/**
	 * Repair a path after ownership/type validation, then ensure the path still names the same object.
	 */
	private async repairModeByPath(
		originalStats: Stats,
		label: string,
		path: string,
		kind: SecurePathKind,
		expectedMode: number,
	): Promise<void> {
		try {
			await chmod(path, expectedMode);
		} catch (error) {
			throw new Error(
				`Unable to secure ${label.toLowerCase()} '${path}' with mode ${this.formatMode(expectedMode)} after access was denied: ${this.getErrorMessage(error)}. Set the required mode and retry.`,
			);
		}

		const repairedStats = await lstat(path);
		this.validatePath(repairedStats, label, path, kind);
		if (originalStats.dev !== repairedStats.dev || originalStats.ino !== repairedStats.ino) {
			throw new Error(
				`${label} '${path}' changed while its permissions were being repaired. Retry the operation.`,
			);
		}

		const actualMode = repairedStats.mode & POSIX_MODE_MASK;
		if (actualMode !== expectedMode) {
			throw new Error(
				`${label} '${path}' must use mode ${this.formatMode(expectedMode)}, but mode ${this.formatMode(actualMode)} remains after repair. Set the required mode and retry.`,
			);
		}
	}

	/**
	 * Validate path type and ownership without reading its contents.
	 */
	private validatePath(stats: Stats, label: string, path: string, kind: SecurePathKind): void {
		if (stats.isSymbolicLink()) {
			throw this.symbolicLinkError(label, path, kind);
		}

		if (kind === 'directory' && !stats.isDirectory()) {
			throw new Error(
				`${label} '${path}' must be a directory. Replace it with a real directory owned by the current user and retry.`,
			);
		}
		if (kind === 'file' && !stats.isFile()) {
			throw new Error(
				`${label} '${path}' must be a regular file. Replace it with a real file owned by the current user and retry.`,
			);
		}

		const currentUid = this.currentUid();
		if (currentUid !== undefined && stats.uid !== currentUid) {
			throw new Error(
				`${label} '${path}' must be owned by the current user (expected uid ${currentUid}, found uid ${stats.uid}). Change its ownership to uid ${currentUid} and retry.`,
			);
		}
	}

	/**
	 * Read and parse an already-secured secrets file.
	 * Returns null if JSON is malformed, throws for other errors.
	 */
	private async readSecrets(file: FileHandle): Promise<Record<string, string> | null> {
		const content = await file.readFile({ encoding: 'utf-8' });
		try {
			return JSON.parse(content) as Record<string, string>;
		} catch {
			return null;
		}
	}

	/**
	 * Replace file contents from byte zero using the validated handle.
	 */
	private async replaceContents(file: FileHandle, content: string): Promise<void> {
		const buffer = Buffer.from(content, 'utf-8');
		await file.truncate(0);

		let offset = 0;
		while (offset < buffer.length) {
			const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, offset);
			if (bytesWritten === 0) {
				throw new Error(`Unable to write secrets file '${this.filePath}': no bytes were written.`);
			}
			offset += bytesWritten;
		}
	}

	private secureFileFlags(flags: number): number {
		if (!this.usesPosixPermissions()) {
			return flags;
		}
		return flags | constants.O_NOFOLLOW | constants.O_NONBLOCK;
	}

	private usesPosixPermissions(): boolean {
		return process.platform !== 'win32';
	}

	private currentUid(): number | undefined {
		if (!this.usesPosixPermissions()) {
			return undefined;
		}
		if (typeof process.getuid !== 'function') {
			throw new Error(
				'Unable to validate secret-store ownership on this platform; use a native credential store.',
			);
		}
		return process.getuid();
	}

	private symbolicLinkError(label: string, path: string, kind: SecurePathKind): Error {
		return new Error(
			`${label} '${path}' must not be a symbolic link. Replace it with a real ${kind} owned by the current user and retry.`,
		);
	}

	private accessError(label: string, path: string, expectedMode: number, error: unknown): Error {
		return new Error(
			`Unable to access ${label.toLowerCase()} '${path}': ${this.getErrorMessage(error)}. Verify current-user ownership, mode ${this.formatMode(expectedMode)}, and any access-control entries, then retry.`,
		);
	}

	private async closeFile(file: FileHandle | undefined): Promise<unknown | undefined> {
		if (file === undefined) {
			return undefined;
		}
		try {
			await file.close();
			return undefined;
		} catch (error) {
			return error;
		}
	}

	private async pathExists(path: string): Promise<boolean> {
		try {
			await lstat(path);
			return true;
		} catch (error) {
			if (this.isNodeError(error) && error.code === 'ENOENT') {
				return false;
			}
			throw error;
		}
	}

	private formatMode(mode: number): string {
		return `0${mode.toString(8)}`;
	}

	/**
	 * Type guard for Node.js errors with code property
	 */
	private isNodeError(error: unknown): error is NodeJS.ErrnoException {
		return error instanceof Error && 'code' in error;
	}

	private isAccessError(error: unknown): boolean {
		return this.isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM');
	}

	private isSymbolicLinkError(error: unknown): boolean {
		return this.isNodeError(error) && (error.code === 'ELOOP' || error.code === 'EMLINK');
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
