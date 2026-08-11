/**
 * Tests for SnapshotStore implementations.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentSessionId } from '../../types/core';
import {
	createFileSnapshotStore,
	createInMemorySnapshotStore,
	type FileSnapshotStore,
	type InMemorySnapshotStore,
} from '../store';
import type { AgentCheckpoint } from '../types';

function createMockCheckpoint(id: string): AgentCheckpoint {
	return {
		timestamp: Date.now(),
		adapterName: 'mock',
		session: {
			id: id as AgentSessionId,
			createdAt: Date.now(),
			tags: ['test'],
			metadata: { key: 'value' },
			task: 'test-task',
			metrics: {
				durationMs: 1000,
				turns: 5,
				toolCalls: 3,
			},
		},
		guidance: {
			guidancePath: '/path/to/guidance',
			memoryWrites: [{ path: 'test.md', content: '# Test', timestamp: Date.now() }],
			systemState: { counter: 1 },
		},
		messages: [],
		adapterConfig: {
			provider: 'mock',
			model: 'mock-model',
		},
		toolExecutions: [],
	};
}

describe('InMemorySnapshotStore', () => {
	let store: InMemorySnapshotStore;

	beforeEach(() => {
		store = createInMemorySnapshotStore();
	});

	describe('save', () => {
		it('should save a checkpoint', async () => {
			const checkpoint = createMockCheckpoint('session-1');
			await store.save(checkpoint);
			expect(store.size).toBe(1);
		});

		it('should deep clone the checkpoint', async () => {
			const checkpoint = createMockCheckpoint('session-1');
			await store.save(checkpoint);

			// Modify original
			checkpoint.session.tags.push('modified');

			// Load and verify it wasn't affected
			const loaded = await store.load('session-1' as AgentSessionId);
			expect(loaded?.session.tags).toEqual(['test']);
		});
	});

	describe('load', () => {
		it('should return null for non-existent session', async () => {
			const result = await store.load('nonexistent' as AgentSessionId);
			expect(result).toBeNull();
		});

		it('should return the saved checkpoint', async () => {
			const checkpoint = createMockCheckpoint('session-1');
			await store.save(checkpoint);

			const loaded = await store.load('session-1' as AgentSessionId);
			expect(loaded).toEqual(checkpoint);
		});

		it('should deep clone on load', async () => {
			const checkpoint = createMockCheckpoint('session-1');
			await store.save(checkpoint);

			const loaded1 = await store.load('session-1' as AgentSessionId);
			const loaded2 = await store.load('session-1' as AgentSessionId);

			// Modify loaded1
			loaded1?.session.tags.push('modified');

			// loaded2 should not be affected
			expect(loaded2?.session.tags).toEqual(['test']);
		});
	});

	describe('delete', () => {
		it('should return false for non-existent session', async () => {
			const result = await store.delete('nonexistent' as AgentSessionId);
			expect(result).toBe(false);
		});

		it('should delete and return true for existing session', async () => {
			const checkpoint = createMockCheckpoint('session-1');
			await store.save(checkpoint);

			const result = await store.delete('session-1' as AgentSessionId);
			expect(result).toBe(true);
			expect(await store.load('session-1' as AgentSessionId)).toBeNull();
		});
	});

	describe('list', () => {
		it('should return empty array for empty store', async () => {
			const result = await store.list();
			expect(result).toEqual([]);
		});

		it('should return all session IDs', async () => {
			await store.save(createMockCheckpoint('session-1'));
			await store.save(createMockCheckpoint('session-2'));
			await store.save(createMockCheckpoint('session-3'));

			const result = await store.list();
			expect(result.sort()).toEqual(['session-1', 'session-2', 'session-3']);
		});
	});

	describe('exists', () => {
		it('should return false for non-existent session', async () => {
			const result = await store.exists('nonexistent' as AgentSessionId);
			expect(result).toBe(false);
		});

		it('should return true for existing session', async () => {
			await store.save(createMockCheckpoint('session-1'));
			const result = await store.exists('session-1' as AgentSessionId);
			expect(result).toBe(true);
		});
	});

	describe('clear', () => {
		it('should remove all checkpoints', async () => {
			await store.save(createMockCheckpoint('session-1'));
			await store.save(createMockCheckpoint('session-2'));

			store.clear();

			expect(store.size).toBe(0);
			expect(await store.list()).toEqual([]);
		});
	});
});

describe('FileSnapshotStore', () => {
	let store: FileSnapshotStore;
	let testDir: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `orchestrator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		await mkdir(testDir, { recursive: true });
		store = createFileSnapshotStore({ directory: testDir }) as FileSnapshotStore;
	});

	afterEach(async () => {
		try {
			await rm(testDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe('save', () => {
		it('should save a checkpoint to file', async () => {
			const checkpoint = createMockCheckpoint('session-1');
			await store.save(checkpoint);

			const loaded = await store.load('session-1' as AgentSessionId);
			expect(loaded).toEqual(checkpoint);
		});

		it('should atomically replace the checkpoint without leaving temporary files', async () => {
			const first = createMockCheckpoint('session-1');
			const second = createMockCheckpoint('session-1');
			second.session.metadata = { generation: 2 };

			await store.save(first);
			await store.save(second);

			expect(await readdir(testDir)).toEqual(['session-1.json']);
			expect(await store.load('session-1' as AgentSessionId)).toEqual(second);
		});

		it('should serialize concurrent saves for the same session in call order', async () => {
			const first = createMockCheckpoint('session-1');
			const second = createMockCheckpoint('session-1');
			first.guidance.systemState = { payload: 'x'.repeat(8 * 1024 * 1024) };
			second.guidance.systemState = { generation: 2 };

			await Promise.all([store.save(first), store.save(second)]);

			expect(await store.load('session-1' as AgentSessionId)).toEqual(second);
			expect(await readdir(testDir)).toEqual(['session-1.json']);
		});

		it('should clean up a temporary file and remain usable when replacement fails', async () => {
			const targetPath = join(testDir, 'session-1.json');
			await mkdir(targetPath);

			await expect(store.save(createMockCheckpoint('session-1'))).rejects.toThrow();
			expect(await readdir(testDir)).toEqual(['session-1.json']);

			await rm(targetPath, { recursive: true });
			const checkpoint = createMockCheckpoint('session-1');
			await store.save(checkpoint);
			expect(await store.load('session-1' as AgentSessionId)).toEqual(checkpoint);
		});
	});

	describe('load', () => {
		it('should return null for non-existent session', async () => {
			const result = await store.load('nonexistent' as AgentSessionId);
			expect(result).toBeNull();
		});

		it('reads an unversioned legacy checkpoint', async () => {
			const checkpoint = createMockCheckpoint('legacy-session');
			await store.save(checkpoint);

			await expect(store.load('legacy-session' as AgentSessionId)).resolves.toEqual(checkpoint);
		});

		it('rejects an unsupported checkpoint version', async () => {
			const checkpoint = { ...createMockCheckpoint('future-session'), version: 999 };
			await writeFile(join(testDir, 'future-session.json'), JSON.stringify(checkpoint), 'utf-8');

			await expect(store.load('future-session' as AgentSessionId)).rejects.toThrow(
				'Unsupported checkpoint version: 999',
			);
		});
	});

	describe('delete', () => {
		it('should delete a checkpoint file', async () => {
			const checkpoint = createMockCheckpoint('session-1');
			await store.save(checkpoint);

			const result = await store.delete('session-1' as AgentSessionId);
			expect(result).toBe(true);
			expect(await store.load('session-1' as AgentSessionId)).toBeNull();
		});

		it('should return false for non-existent session', async () => {
			const result = await store.delete('nonexistent' as AgentSessionId);
			expect(result).toBe(false);
		});
	});

	describe('list', () => {
		it('should return all session IDs', async () => {
			await store.save(createMockCheckpoint('session-1'));
			await store.save(createMockCheckpoint('session-2'));

			const result = await store.list();
			expect(result.sort()).toEqual(['session-1', 'session-2']);
		});
	});

	describe('exists', () => {
		it('should return true for existing session', async () => {
			await store.save(createMockCheckpoint('session-1'));
			const result = await store.exists('session-1' as AgentSessionId);
			expect(result).toBe(true);
		});

		it('should return false for non-existent session', async () => {
			const result = await store.exists('nonexistent' as AgentSessionId);
			expect(result).toBe(false);
		});
	});
});
