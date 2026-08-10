import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Destination } from '@genii/comms/destination/types';
import type { ChannelId } from '@genii/comms/types/core';
import type { AgentSessionId } from '@genii/orchestrator/types/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../logging/logger';
import { createFileConversationStore } from '../store';
import type { ConversationBinding, SerializedConversationBinding } from '../types';

function createMockLogger(): Logger {
	const mockLogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(() => mockLogger),
	};
	return mockLogger as unknown as Logger;
}

function createBinding(ref: string, agentId: string): ConversationBinding {
	const timestamp = new Date('2026-08-10T12:00:00.000Z');
	return {
		destination: { channelId: 'channel-1' as ChannelId, ref } satisfies Destination,
		agentId: agentId as AgentSessionId,
		createdAt: timestamp,
		lastActivityAt: timestamp,
	};
}

describe('FileConversationStore', () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
	});

	it('should atomically replace snapshots in invocation order', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'genii-conversations-'));
		temporaryDirectories.push(directory);
		const filePath = join(directory, 'conversations.json');
		const store = createFileConversationStore(filePath, createMockLogger());
		const firstBinding = createBinding('user-1', 'agent-1');
		const secondBinding = createBinding('user-2', 'agent-2');

		await Promise.all([store.save([firstBinding]), store.save([firstBinding, secondBinding])]);

		const serialized = JSON.parse(await readFile(filePath, 'utf-8')) as SerializedConversationBinding[];
		expect(serialized).toHaveLength(2);
		expect(serialized[1]?.agentId).toBe('agent-2');
		expect(await readdir(directory)).toEqual(['conversations.json']);
	});

	it('should load dates from the persisted snapshot', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'genii-conversations-'));
		temporaryDirectories.push(directory);
		const store = createFileConversationStore(join(directory, 'conversations.json'), createMockLogger());
		const binding = createBinding('user-1', 'agent-1');

		await store.save([binding]);
		const loaded = await store.load();

		expect(loaded).toEqual([binding]);
		expect(loaded[0]?.createdAt).toBeInstanceOf(Date);
		expect(loaded[0]?.lastActivityAt).toBeInstanceOf(Date);
	});
});
