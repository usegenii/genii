/**
 * Memory system implementation.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { Disposable } from '../types/core.js';
import type { MemorySystem } from './types.js';

/**
 * File-based memory system implementation.
 */
export class MemorySystemImpl implements MemorySystem {
	private readonly memoriesDir: string;
	private readonly stateDir: string;
	private writeHandlers = new Set<(path: string, content: string) => void>();
	private deleteHandlers = new Set<(path: string) => void>();
	private fileLocks = new Map<string, Promise<void>>();

	constructor(guidancePath: string) {
		this.memoriesDir = join(guidancePath, 'memories');
		this.stateDir = join(guidancePath, 'memories', '.system');
	}

	/**
	 * Read a markdown file from memory.
	 */
	async read(path: string): Promise<string | null> {
		const fullPath = this.resolvePath(path);
		try {
			return await readFile(fullPath, 'utf-8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Write a markdown file to memory.
	 */
	async write(path: string, content: string): Promise<void> {
		const fullPath = this.resolvePath(path);

		// Ensure directory exists
		await mkdir(dirname(fullPath), { recursive: true });

		// Write file
		await writeFile(fullPath, content, 'utf-8');

		// Notify handlers
		for (const handler of this.writeHandlers) {
			try {
				handler(path, content);
			} catch (error) {
				console.error('Error in memory write handler:', error);
			}
		}
	}

	/**
	 * Delete a file from memory.
	 */
	async delete(path: string): Promise<void> {
		const fullPath = this.resolvePath(path);
		try {
			await rm(fullPath);

			// Notify handlers
			for (const handler of this.deleteHandlers) {
				try {
					handler(path);
				} catch (error) {
					console.error('Error in memory delete handler:', error);
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}

	/**
	 * List files in memory.
	 */
	async list(pattern?: string): Promise<string[]> {
		try {
			const files = await this.listFilesRecursive(this.memoriesDir);
			// Filter out .system directory
			const filtered = files.filter((f) => !f.startsWith('.system/'));

			if (pattern) {
				const regex = this.globToRegex(pattern);
				return filtered.filter((f) => regex.test(f));
			}

			return filtered;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			throw error;
		}
	}

	/**
	 * Get a JSON state value.
	 */
	async getState<T>(key: string): Promise<T | null> {
		const path = this.stateKeyPath(key);
		try {
			const content = await readFile(path, 'utf-8');
			return JSON.parse(content) as T;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Set a JSON state value.
	 */
	async setState<T>(key: string, value: T): Promise<void> {
		const path = this.stateKeyPath(key);

		// Ensure directory exists
		await mkdir(dirname(path), { recursive: true });

		// Write atomically using file locking
		await this.withLock(path, async () => {
			await writeFile(path, JSON.stringify(value, null, 2), 'utf-8');
		});
	}

	/**
	 * Atomically update a JSON state value.
	 */
	async updateState<T>(key: string, fn: (current: T | null) => T): Promise<void> {
		const path = this.stateKeyPath(key);

		// Ensure directory exists
		await mkdir(dirname(path), { recursive: true });

		await this.withLock(path, async () => {
			let current: T | null = null;
			try {
				const content = await readFile(path, 'utf-8');
				current = JSON.parse(content) as T;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
			}

			const newValue = fn(current);
			await writeFile(path, JSON.stringify(newValue, null, 2), 'utf-8');
		});
	}

	/**
	 * List all state keys.
	 */
	async listStateKeys(): Promise<string[]> {
		try {
			const entries = await readdir(this.stateDir, { withFileTypes: true });
			return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name.slice(0, -5)); // Remove .json extension
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			throw error;
		}
	}

	/**
	 * Subscribe to write events.
	 */
	onWrite(handler: (path: string, content: string) => void): Disposable {
		this.writeHandlers.add(handler);
		return () => this.writeHandlers.delete(handler);
	}

	/**
	 * Subscribe to delete events.
	 */
	onDelete(handler: (path: string) => void): Disposable {
		this.deleteHandlers.add(handler);
		return () => this.deleteHandlers.delete(handler);
	}

	/**
	 * Resolve a relative path to the memories directory.
	 */
	private resolvePath(path: string): string {
		// Prevent path traversal
		const resolved = join(this.memoriesDir, path);
		if (!resolved.startsWith(this.memoriesDir)) {
			throw new Error(`Invalid path: ${path}`);
		}
		return resolved;
	}

	/**
	 * Get the path for a state key.
	 */
	private stateKeyPath(key: string): string {
		// Sanitize key to prevent path traversal
		const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, '_');
		return join(this.stateDir, `${sanitized}.json`);
	}

	/**
	 * Recursively list files in a directory.
	 */
	private async listFilesRecursive(dir: string): Promise<string[]> {
		const entries = await readdir(dir, { withFileTypes: true });
		const files: string[] = [];

		for (const entry of entries) {
			const entryPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				const nested = await this.listFilesRecursive(entryPath);
				files.push(...nested);
			} else {
				files.push(relative(this.memoriesDir, entryPath));
			}
		}

		return files;
	}

	/**
	 * Convert a glob pattern to a regex.
	 */
	private globToRegex(pattern: string): RegExp {
		const escaped = pattern
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')
			.replace(/\*/g, '.*')
			.replace(/\?/g, '.');
		return new RegExp(`^${escaped}$`);
	}

	/**
	 * Execute a function with a file lock.
	 */
	private async withLock(path: string, fn: () => Promise<void>): Promise<void> {
		// Wait for any existing lock
		const existingLock = this.fileLocks.get(path);
		if (existingLock) {
			await existingLock;
		}

		// Create new lock
		let resolve: (() => void) | undefined;
		const lock = new Promise<void>((r) => {
			resolve = r;
		});
		this.fileLocks.set(path, lock);

		try {
			await fn();
		} finally {
			this.fileLocks.delete(path);
			resolve?.();
		}
	}
}

/**
 * Create a memory system for a guidance path.
 */
export function createMemorySystem(guidancePath: string): MemorySystem {
	return new MemorySystemImpl(guidancePath);
}
