import { constants, type Stats } from 'node:fs';
import { type FileHandle, lstat, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretResult, SecretStore } from './types.js';

const DIRECTORY_MODE = 0o700;
const SECRET_FILE_MODE = 0o600;
const POSIX_MODE_MASK = 0o7777;

type SecretPathKind = 'directory' | 'file';

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
			await this.ensureDataDirectory(false);
			file = await this.openValidatedExistingFile(false);

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
			await this.ensureDataDirectory(true);
			const openedFile = await this.openFileForWrite();
			file = openedFile.handle;

			const secrets = openedFile.created ? {} : await this.readSecrets(file);
			if (secrets === null) {
				result = { success: false, error: 'Failed to parse existing secrets file: malformed JSON' };
			} else {
				secrets[name] = value;
				await this.replaceContents(file, JSON.stringify(secrets, null, '\t'));
				await this.validateHandle(file, 'Secrets file', this.filePath, 'file');
				await this.ensureDataDirectory(false);

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
	 * Ensure the containing data directory is real, current-user-owned, and no more permissive than 0700 on POSIX.
	 * The requested mode applies only when mkdir creates a missing path; existing permissions are validation-only.
	 */
	private async ensureDataDirectory(create: boolean): Promise<void> {
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
	}

	/**
	 * Open and validate an existing file. Writable opens retain the validated inode and never truncate before validation.
	 */
	private async openValidatedExistingFile(writable: boolean): Promise<FileHandle> {
		const readOnlyFile = await this.openAndValidateExistingFile(constants.O_RDONLY);
		if (!writable) {
			return readOnlyFile.handle;
		}

		let writableFile: { handle: FileHandle; stats: Stats } | undefined;
		try {
			writableFile = await this.openAndValidateExistingFile(constants.O_RDWR);
			if (
				readOnlyFile.stats.dev !== writableFile.stats.dev ||
				readOnlyFile.stats.ino !== writableFile.stats.ino
			) {
				throw new Error(
					`Secrets file '${this.filePath}' changed while it was being validated. Retry the operation.`,
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
	private async openFileForWrite(): Promise<OpenSecretFile> {
		if (await this.pathExists(this.filePath)) {
			return { handle: await this.openValidatedExistingFile(true), created: false };
		}

		let file: FileHandle | undefined;
		try {
			file = await open(
				this.filePath,
				this.fileOpenFlags(constants.O_CREAT | constants.O_EXCL | constants.O_RDWR),
				SECRET_FILE_MODE,
			);
			await this.validateHandle(file, 'Secrets file', this.filePath, 'file');
			return { handle: file, created: true };
		} catch (error) {
			await file?.close();
			if (this.isNodeError(error) && error.code === 'EEXIST') {
				return { handle: await this.openValidatedExistingFile(true), created: false };
			}
			if (this.isAccessError(error)) {
				throw this.createFileAccessError(error);
			}
			throw error;
		}
	}

	/**
	 * Validate a path before opening it, then validate the opened file handle without changing its permissions.
	 */
	private async openAndValidateExistingFile(flags: number): Promise<{ handle: FileHandle; stats: Stats }> {
		const pathStats = await lstat(this.filePath);
		this.validatePath(pathStats, 'Secrets file', this.filePath, 'file');

		let file: FileHandle | undefined;
		try {
			file = await this.openValidatedPath(
				'Secrets file',
				this.filePath,
				'file',
				SECRET_FILE_MODE,
				this.fileOpenFlags(flags),
			);
			const stats = await this.validateHandle(file, 'Secrets file', this.filePath, 'file');
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
	 * Validate ownership, type, and permissions on an opened path without changing its metadata.
	 */
	private async validateHandle(
		handle: FileHandle,
		label: string,
		path: string,
		kind: SecretPathKind,
	): Promise<Stats> {
		const stats = await handle.stat();
		this.validatePath(stats, label, path, kind);
		return stats;
	}

	/**
	 * Open a validated path without following a final-component symlink or changing existing permissions.
	 */
	private async openValidatedPath(
		label: string,
		path: string,
		kind: SecretPathKind,
		allowedMode: number,
		flags: number,
	): Promise<FileHandle> {
		try {
			return await open(path, flags);
		} catch (error) {
			if (this.isSymbolicLinkError(error)) {
				throw this.symbolicLinkError(label, path, kind);
			}
			if (this.isAccessError(error)) {
				throw this.accessError(label, path, allowedMode, error);
			}
			throw error;
		}
	}

	/**
	 * Validate path type and ownership without reading its contents.
	 */
	private validatePath(stats: Stats, label: string, path: string, kind: SecretPathKind): void {
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

		if (this.usesPosixPermissions()) {
			const allowedMode = kind === 'directory' ? DIRECTORY_MODE : SECRET_FILE_MODE;
			const actualMode = stats.mode & POSIX_MODE_MASK;
			const disallowedMode = actualMode & (POSIX_MODE_MASK ^ allowedMode);
			if (disallowedMode !== 0) {
				throw new Error(
					`${label} '${path}' has insecure mode ${this.formatMode(actualMode)}. Permissions must be a subset of ${this.formatMode(allowedMode)} with no group, world, or special permission bits. Use chmod to set mode ${this.formatMode(allowedMode)} or a stricter subset and retry; Genii will not change existing permissions.`,
				);
			}
		}
	}

	/**
	 * Read and parse an already-validated secrets file.
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

	private fileOpenFlags(flags: number): number {
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

	private symbolicLinkError(label: string, path: string, kind: SecretPathKind): Error {
		return new Error(
			`${label} '${path}' must not be a symbolic link. Replace it with a real ${kind} owned by the current user and retry.`,
		);
	}

	private createFileAccessError(error: unknown): Error {
		const directoryPath = dirname(this.filePath);
		return new Error(
			`Unable to create secrets file '${this.filePath}': ${this.getErrorMessage(error)}. The existing data directory '${directoryPath}' must grant the owner write and execute access within mode ${this.formatMode(DIRECTORY_MODE)}. Use chmod to set a usable subset such as ${this.formatMode(DIRECTORY_MODE)} and retry; Genii will not change existing permissions.`,
		);
	}

	private accessError(label: string, path: string, allowedMode: number, error: unknown): Error {
		return new Error(
			`Unable to access ${label.toLowerCase()} '${path}': ${this.getErrorMessage(error)}. Verify current-user ownership, a usable mode that is a subset of ${this.formatMode(allowedMode)}, and any access-control entries, then retry. Genii will not change existing permissions.`,
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
		return `0${mode.toString(8).padStart(3, '0')}`;
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
