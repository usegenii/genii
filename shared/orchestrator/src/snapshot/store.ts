/**
 * Snapshot store implementations.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { AgentSessionId } from '../types/core';
import { type AgentCheckpoint, CHECKPOINT_VERSION, type FileSnapshotStoreOptions, type SnapshotStore } from './types';

/**
 * File-based snapshot store.
 * Stores checkpoints as JSON files in a directory.
 */
export class FileSnapshotStore implements SnapshotStore {
	private readonly directory: string;
	private initialized = false;
	private readonly pendingSaves = new Map<string, Promise<void>>();

	constructor(options: FileSnapshotStoreOptions) {
		this.directory = options.directory;
	}

	/**
	 * Ensure the store directory exists.
	 */
	private async ensureInitialized(): Promise<void> {
		if (this.initialized) return;

		await mkdir(this.directory, { recursive: true });
		this.initialized = true;
	}

	/**
	 * Get the file path for a session ID.
	 */
	private getPath(sessionId: AgentSessionId): string {
		// Sanitize session ID to prevent path traversal
		const sanitized = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
		return join(this.directory, `${sanitized}.json`);
	}

	/**
	 * Save a checkpoint.
	 */
	async save(checkpoint: AgentCheckpoint): Promise<void> {
		const path = this.getPath(checkpoint.session.id);
		const content = JSON.stringify(checkpoint, null, 2);
		const previousSave = this.pendingSaves.get(path) ?? Promise.resolve();
		const currentSave = previousSave
			.catch(() => undefined)
			.then(async () => {
				await this.ensureInitialized();
				await this.replaceFile(path, content);
			});

		this.pendingSaves.set(path, currentSave);

		try {
			await currentSave;
		} finally {
			if (this.pendingSaves.get(path) === currentSave) {
				this.pendingSaves.delete(path);
			}
		}
	}

	/**
	 * Replace a checkpoint without exposing a partially written JSON document.
	 */
	private async replaceFile(path: string, content: string): Promise<void> {
		const temporaryPath = join(this.directory, `.${basename(path)}.${process.pid}-${randomUUID()}.tmp`);

		try {
			await writeFile(temporaryPath, content, 'utf-8');
			await rename(temporaryPath, path);
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
			throw error;
		}
	}

	/**
	 * Load a checkpoint by session ID.
	 */
	async load(sessionId: AgentSessionId): Promise<AgentCheckpoint | null> {
		const path = this.getPath(sessionId);

		try {
			const content = await readFile(path, 'utf-8');
			const parsed: unknown = JSON.parse(content);
			const version =
				typeof parsed === 'object' && parsed !== null ? (parsed as { version?: unknown }).version : undefined;
			if (version !== undefined && version !== CHECKPOINT_VERSION) {
				throw new Error(`Unsupported checkpoint version: ${String(version)}`);
			}
			return parsed as AgentCheckpoint;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Delete a checkpoint.
	 */
	async delete(sessionId: AgentSessionId): Promise<boolean> {
		const path = this.getPath(sessionId);

		try {
			await rm(path);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return false;
			}
			throw error;
		}
	}

	/**
	 * List all checkpoint session IDs.
	 */
	async list(): Promise<AgentSessionId[]> {
		await this.ensureInitialized();

		try {
			const entries = await readdir(this.directory, { withFileTypes: true });
			return entries
				.filter((e) => e.isFile() && e.name.endsWith('.json'))
				.map((e) => e.name.slice(0, -5) as AgentSessionId);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			throw error;
		}
	}

	/**
	 * Check if a checkpoint exists.
	 */
	async exists(sessionId: AgentSessionId): Promise<boolean> {
		const path = this.getPath(sessionId);

		try {
			await readFile(path);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return false;
			}
			throw error;
		}
	}
}

/**
 * In-memory snapshot store for testing.
 */
export class InMemorySnapshotStore implements SnapshotStore {
	private checkpoints = new Map<AgentSessionId, AgentCheckpoint>();

	async save(checkpoint: AgentCheckpoint): Promise<void> {
		// Deep clone to prevent mutations
		const cloned = JSON.parse(JSON.stringify(checkpoint)) as AgentCheckpoint;
		this.checkpoints.set(checkpoint.session.id, cloned);
	}

	async load(sessionId: AgentSessionId): Promise<AgentCheckpoint | null> {
		const checkpoint = this.checkpoints.get(sessionId);
		if (!checkpoint) return null;

		// Deep clone to prevent mutations
		return JSON.parse(JSON.stringify(checkpoint)) as AgentCheckpoint;
	}

	async delete(sessionId: AgentSessionId): Promise<boolean> {
		return this.checkpoints.delete(sessionId);
	}

	async list(): Promise<AgentSessionId[]> {
		return [...this.checkpoints.keys()];
	}

	async exists(sessionId: AgentSessionId): Promise<boolean> {
		return this.checkpoints.has(sessionId);
	}

	/**
	 * Clear all checkpoints.
	 */
	clear(): void {
		this.checkpoints.clear();
	}

	/**
	 * Get the number of stored checkpoints.
	 */
	get size(): number {
		return this.checkpoints.size;
	}
}

/**
 * Create a file-based snapshot store.
 */
export function createFileSnapshotStore(options: FileSnapshotStoreOptions): SnapshotStore {
	return new FileSnapshotStore(options);
}

/**
 * Create an in-memory snapshot store for testing.
 */
export function createInMemorySnapshotStore(): InMemorySnapshotStore {
	return new InMemorySnapshotStore();
}
