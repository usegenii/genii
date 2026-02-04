import type { Destination } from '@genii/comms/destination/types';
import type { ChannelId } from '@genii/comms/types/core';
import type { AgentSessionId } from '@genii/orchestrator/types/core';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../logging/logger';
import { ConversationManager } from '../manager';
import type { ConversationBinding } from '../types';

/**
 * Create a minimal mock logger for testing.
 */
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

/**
 * Create a test destination with proper branded types.
 */
function createDestination(channelId: string, ref: string): Destination {
	return { channelId: channelId as ChannelId, ref };
}

/**
 * Create a test agent ID with proper branded type.
 */
function createAgentId(id: string): AgentSessionId {
	return id as AgentSessionId;
}

/**
 * Create a channel ID with proper branded type.
 */
function createChannelId(id: string): ChannelId {
	return id as ChannelId;
}

describe('ConversationManager', () => {
	describe('getOrCreate()', () => {
		it('should create a new binding for unknown destination', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');

			const binding = manager.getOrCreate(destination);

			expect(binding).toBeDefined();
			expect(binding.destination).toEqual(destination);
			expect(binding.agentId).toBeNull();
			expect(binding.createdAt).toBeInstanceOf(Date);
			expect(binding.lastActivityAt).toBeInstanceOf(Date);
		});

		it('should return existing binding for known destination', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');

			const binding1 = manager.getOrCreate(destination);
			const binding2 = manager.getOrCreate(destination);

			expect(binding1).toBe(binding2);
		});

		it('should create different bindings for different destinations', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const dest1 = createDestination('channel-1', 'user-123');
			const dest2 = createDestination('channel-1', 'user-456');

			const binding1 = manager.getOrCreate(dest1);
			const binding2 = manager.getOrCreate(dest2);

			expect(binding1).not.toBe(binding2);
		});
	});

	describe('bind()', () => {
		it('should bind an agent to a destination', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');
			const agentId = createAgentId('agent-1');

			manager.bind(destination, agentId);

			const binding = manager.getByDestination(destination);
			expect(binding?.agentId).toBe(agentId);
		});

		it('should create binding if it does not exist', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');
			const agentId = createAgentId('agent-1');

			manager.bind(destination, agentId);

			expect(manager.totalCount).toBe(1);
			expect(manager.activeCount).toBe(1);
		});

		it('should update lastActivityAt when binding', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');

			const binding = manager.getOrCreate(destination);
			const originalLastActivity = binding.lastActivityAt;

			// Wait a tiny bit to ensure time changes
			vi.useFakeTimers();
			vi.advanceTimersByTime(100);

			manager.bind(destination, createAgentId('agent-1'));

			expect(binding.lastActivityAt.getTime()).toBeGreaterThan(originalLastActivity.getTime());
			vi.useRealTimers();
		});

		it('should remove old agent mapping when rebinding', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');

			manager.bind(destination, createAgentId('agent-1'));
			manager.bind(destination, createAgentId('agent-2'));

			// Old agent should no longer be mapped
			expect(manager.getByAgent(createAgentId('agent-1'))).toBeUndefined();
			// New agent should be mapped
			expect(manager.getByAgent(createAgentId('agent-2'))).toBeDefined();
		});
	});

	describe('unbind()', () => {
		it('should unbind agent from destination', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');

			manager.bind(destination, createAgentId('agent-1'));
			manager.unbind(destination);

			const binding = manager.getByDestination(destination);
			expect(binding?.agentId).toBeNull();
		});

		it('should keep binding but clear agent reference', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');

			manager.bind(destination, createAgentId('agent-1'));
			manager.unbind(destination);

			expect(manager.totalCount).toBe(1);
			expect(manager.activeCount).toBe(0);
		});

		it('should handle unbinding non-existent destination gracefully', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');

			expect(() => manager.unbind(destination)).not.toThrow();
		});

		it('should handle unbinding destination with no agent gracefully', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');

			manager.getOrCreate(destination);
			expect(() => manager.unbind(destination)).not.toThrow();
		});
	});

	describe('getByDestination()', () => {
		it('should return binding for known destination', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');

			manager.getOrCreate(destination);

			const binding = manager.getByDestination(destination);
			expect(binding).toBeDefined();
			expect(binding?.destination).toEqual(destination);
		});

		it('should return undefined for unknown destination', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'unknown');

			const binding = manager.getByDestination(destination);
			expect(binding).toBeUndefined();
		});
	});

	describe('getByAgent()', () => {
		it('should return binding for known agent', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const destination = createDestination('channel-1', 'user-123');
			const agentId = createAgentId('agent-1');

			manager.bind(destination, agentId);

			const binding = manager.getByAgent(agentId);
			expect(binding).toBeDefined();
			expect(binding?.agentId).toBe(agentId);
		});

		it('should return undefined for unknown agent', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			const binding = manager.getByAgent(createAgentId('unknown-agent'));
			expect(binding).toBeUndefined();
		});
	});

	describe('list()', () => {
		it('should return all bindings when no filter provided', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			manager.getOrCreate(createDestination('channel-1', 'user-1'));
			manager.getOrCreate(createDestination('channel-1', 'user-2'));
			manager.getOrCreate(createDestination('channel-2', 'user-3'));

			const bindings = manager.list();
			expect(bindings).toHaveLength(3);
		});

		it('should filter by channelId', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			manager.getOrCreate(createDestination('channel-1', 'user-1'));
			manager.getOrCreate(createDestination('channel-1', 'user-2'));
			manager.getOrCreate(createDestination('channel-2', 'user-3'));

			const bindings = manager.list({ channelId: createChannelId('channel-1') });
			expect(bindings).toHaveLength(2);
			expect(bindings.every((b) => b.destination.channelId === 'channel-1')).toBe(true);
		});

		it('should filter by hasAgent true', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			manager.bind(createDestination('channel-1', 'user-1'), createAgentId('agent-1'));
			manager.getOrCreate(createDestination('channel-1', 'user-2'));
			manager.bind(createDestination('channel-1', 'user-3'), createAgentId('agent-2'));

			const bindings = manager.list({ hasAgent: true });
			expect(bindings).toHaveLength(2);
			expect(bindings.every((b) => b.agentId !== null)).toBe(true);
		});

		it('should filter by hasAgent false', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			manager.bind(createDestination('channel-1', 'user-1'), createAgentId('agent-1'));
			manager.getOrCreate(createDestination('channel-1', 'user-2'));
			manager.getOrCreate(createDestination('channel-1', 'user-3'));

			const bindings = manager.list({ hasAgent: false });
			expect(bindings).toHaveLength(2);
			expect(bindings.every((b) => b.agentId === null)).toBe(true);
		});

		it('should combine filters', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);
			const agentId1 = createAgentId('agent-1');

			manager.bind(createDestination('channel-1', 'user-1'), agentId1);
			manager.getOrCreate(createDestination('channel-1', 'user-2'));
			manager.bind(createDestination('channel-2', 'user-3'), createAgentId('agent-2'));

			const bindings = manager.list({ channelId: createChannelId('channel-1'), hasAgent: true });
			expect(bindings).toHaveLength(1);
			expect(bindings[0]?.destination.channelId).toBe('channel-1');
			expect(bindings[0]?.agentId).toBe(agentId1);
		});
	});

	describe('snapshot()', () => {
		it('should return all bindings', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			manager.bind(createDestination('channel-1', 'user-1'), createAgentId('agent-1'));
			manager.getOrCreate(createDestination('channel-1', 'user-2'));
			manager.bind(createDestination('channel-2', 'user-3'), createAgentId('agent-2'));

			const snapshot = manager.snapshot();
			expect(snapshot).toHaveLength(3);
		});

		it('should return empty array when no bindings', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			const snapshot = manager.snapshot();
			expect(snapshot).toEqual([]);
		});
	});

	describe('restore()', () => {
		it('should restore bindings from snapshot', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			const now = new Date();
			const bindings: ConversationBinding[] = [
				{
					destination: createDestination('channel-1', 'user-1'),
					agentId: createAgentId('agent-1'),
					createdAt: now,
					lastActivityAt: now,
				},
				{
					destination: createDestination('channel-1', 'user-2'),
					agentId: null,
					createdAt: now,
					lastActivityAt: now,
				},
			];

			manager.restore(bindings);

			expect(manager.totalCount).toBe(2);
			expect(manager.activeCount).toBe(1);
		});

		it('should clear existing state before restoring', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			// Add some initial bindings
			manager.bind(createDestination('channel-1', 'user-old'), createAgentId('agent-old'));
			expect(manager.totalCount).toBe(1);

			// Restore new bindings
			const now = new Date();
			manager.restore([
				{
					destination: createDestination('channel-1', 'user-new'),
					agentId: createAgentId('agent-new'),
					createdAt: now,
					lastActivityAt: now,
				},
			]);

			expect(manager.totalCount).toBe(1);
			expect(manager.getByAgent(createAgentId('agent-old'))).toBeUndefined();
			expect(manager.getByAgent(createAgentId('agent-new'))).toBeDefined();
		});

		it('should properly index agent mappings when restoring', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			const now = new Date();
			const bindings: ConversationBinding[] = [
				{
					destination: createDestination('channel-1', 'user-1'),
					agentId: createAgentId('agent-1'),
					createdAt: now,
					lastActivityAt: now,
				},
				{
					destination: createDestination('channel-1', 'user-2'),
					agentId: createAgentId('agent-2'),
					createdAt: now,
					lastActivityAt: now,
				},
			];

			manager.restore(bindings);

			expect(manager.getByAgent(createAgentId('agent-1'))?.destination.ref).toBe('user-1');
			expect(manager.getByAgent(createAgentId('agent-2'))?.destination.ref).toBe('user-2');
		});
	});

	describe('activeCount', () => {
		it('should return count of bindings with agents', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			manager.bind(createDestination('channel-1', 'user-1'), createAgentId('agent-1'));
			manager.getOrCreate(createDestination('channel-1', 'user-2'));
			manager.bind(createDestination('channel-1', 'user-3'), createAgentId('agent-2'));

			expect(manager.activeCount).toBe(2);
		});
	});

	describe('totalCount', () => {
		it('should return total count of all bindings', () => {
			const logger = createMockLogger();
			const manager = new ConversationManager(logger);

			manager.bind(createDestination('channel-1', 'user-1'), createAgentId('agent-1'));
			manager.getOrCreate(createDestination('channel-1', 'user-2'));
			manager.bind(createDestination('channel-1', 'user-3'), createAgentId('agent-2'));

			expect(manager.totalCount).toBe(3);
		});
	});
});
