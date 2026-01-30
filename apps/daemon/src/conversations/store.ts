/**
 * Persistence store for conversation bindings.
 *
 * This module provides:
 * - File-based persistence for conversation bindings
 * - Atomic writes using write-then-rename pattern for data integrity
 * - Recovery from corrupted or missing state
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentSessionId } from '@geniigotchi/orchestrator/types/core';
import type { Logger } from '../logging/logger';
import type { ConversationBinding, SerializedConversationBinding } from './types';

/**
 * Interface for conversation binding persistence.
 */
export interface ConversationStore {
	/**
	 * Load all persisted bindings.
	 *
	 * Returns an empty array if the file doesn't exist or is corrupted.
	 *
	 * @returns Array of conversation bindings
	 */
	load(): Promise<ConversationBinding[]>;

	/**
	 * Save bindings to persistent storage.
	 *
	 * Uses atomic write (write-then-rename) to prevent corruption.
	 *
	 * @param bindings - Array of bindings to save
	 */
	save(bindings: ConversationBinding[]): Promise<void>;
}

/**
 * Serialize a binding for JSON storage.
 */
function serializeBinding(binding: ConversationBinding): SerializedConversationBinding {
	return {
		destination: binding.destination,
		agentId: binding.agentId,
		createdAt: binding.createdAt.toISOString(),
		lastActivityAt: binding.lastActivityAt.toISOString(),
	};
}

/**
 * Deserialize a binding from JSON storage.
 */
function deserializeBinding(serialized: SerializedConversationBinding): ConversationBinding {
	return {
		destination: serialized.destination,
		agentId: serialized.agentId as AgentSessionId | null,
		createdAt: new Date(serialized.createdAt),
		lastActivityAt: new Date(serialized.lastActivityAt),
	};
}

/**
 * File-based implementation of ConversationStore.
 */
class FileConversationStore implements ConversationStore {
	private readonly _filePath: string;
	private readonly _logger: Logger;

	constructor(filePath: string, logger: Logger) {
		this._filePath = filePath;
		this._logger = logger.child({ component: 'ConversationStore', filePath });
	}

	async load(): Promise<ConversationBinding[]> {
		try {
			const content = await readFile(this._filePath, 'utf-8');
			const serialized = JSON.parse(content) as SerializedConversationBinding[];

			if (!Array.isArray(serialized)) {
				this._logger.warn('Invalid store format: expected array, returning empty');
				return [];
			}

			const bindings = serialized.map(deserializeBinding);
			this._logger.debug({ count: bindings.length }, 'Loaded bindings from store');
			return bindings;
		} catch (error) {
			if (isNodeError(error) && error.code === 'ENOENT') {
				this._logger.debug('Store file does not exist, returning empty array');
				return [];
			}

			this._logger.warn({ error }, 'Failed to load store, returning empty array');
			return [];
		}
	}

	async save(bindings: ConversationBinding[]): Promise<void> {
		const serialized = bindings.map(serializeBinding);
		const content = JSON.stringify(serialized, null, '\t');

		// Ensure directory exists
		const dir = dirname(this._filePath);
		await mkdir(dir, { recursive: true });

		// Write to temp file first
		const tempPath = `${this._filePath}.tmp.${Date.now()}`;

		try {
			await writeFile(tempPath, content, 'utf-8');

			// Atomic rename
			await rename(tempPath, this._filePath);

			this._logger.debug({ count: bindings.length }, 'Saved bindings to store');
		} catch (error) {
			// Clean up temp file on error
			try {
				await unlink(tempPath);
			} catch {
				// Ignore cleanup errors
			}
			throw error;
		}
	}
}

/**
 * Type guard for Node.js errors with code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}

/**
 * Create a file-based conversation store.
 *
 * @param filePath - Path to the JSON file for storing bindings
 * @param logger - Logger instance for logging
 * @returns A ConversationStore implementation
 */
export function createFileConversationStore(filePath: string, logger: Logger): ConversationStore {
	return new FileConversationStore(filePath, logger);
}
