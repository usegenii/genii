/**
 * Tests for ToolRegistry.
 */

import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../types/logger';
import { createToolRegistry, createToolRegistryWith } from '../registry';
import type { Tool, ToolContext, ToolResult } from '../types';

// Helper to create a mock tool
function createMockTool(name: string, category?: string): Tool<unknown, string> {
	return {
		name,
		label: name,
		description: `Mock tool: ${name}`,
		parameters: Type.Object({}),
		execute: async (_input: unknown, _context: ToolContext): Promise<ToolResult<string>> => ({
			status: 'success',
			output: `Result from ${name}`,
		}),
		category,
	};
}

describe('ToolRegistry', () => {
	describe('createToolRegistry', () => {
		it('should create an empty registry', () => {
			const registry = createToolRegistry();
			expect(registry.all()).toHaveLength(0);
		});
	});

	describe('createToolRegistryWith', () => {
		it('should create a registry with initial tools', () => {
			const registry = createToolRegistryWith({}, createMockTool('tool1'), createMockTool('tool2'));
			expect(registry.all()).toHaveLength(2);
		});
	});

	describe('register', () => {
		it('should add a tool to the registry', () => {
			const registry = createToolRegistry();
			const tool = createMockTool('test');
			registry.register(tool);
			expect(registry.all()).toHaveLength(1);
			expect(registry.get('test')).toBe(tool);
		});

		it('should throw error for duplicate tool name', () => {
			const registry = createToolRegistry();
			const tool1 = createMockTool('test');
			const tool2 = createMockTool('test');
			registry.register(tool1);
			expect(() => registry.register(tool2)).toThrow('Tool "test" is already registered');
		});

		it('should log when registering a tool', () => {
			const mockLogger: Logger = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				child: vi.fn(() => mockLogger),
			};
			const registry = createToolRegistry({ logger: mockLogger });
			const tool = createMockTool('test', 'category1');
			registry.register(tool);
			expect(mockLogger.info).toHaveBeenCalledWith(
				{ tool: 'test', category: 'category1' },
				'Registered tool: test',
			);
		});
	});

	describe('get', () => {
		it('should return undefined for non-existent tool', () => {
			const registry = createToolRegistry();
			expect(registry.get('nonexistent')).toBeUndefined();
		});

		it('should return the registered tool', () => {
			const registry = createToolRegistry();
			const tool = createMockTool('test');
			registry.register(tool);
			expect(registry.get('test')).toBe(tool);
		});
	});

	describe('all', () => {
		it('should return all registered tools', () => {
			const registry = createToolRegistry();
			registry.register(createMockTool('tool1'));
			registry.register(createMockTool('tool2'));
			registry.register(createMockTool('tool3'));
			expect(registry.all()).toHaveLength(3);
		});
	});

	describe('byCategory', () => {
		it('should return tools matching the category', () => {
			const registry = createToolRegistry();
			registry.register(createMockTool('tool1', 'category1'));
			registry.register(createMockTool('tool2', 'category1'));
			registry.register(createMockTool('tool3', 'category2'));
			const category1Tools = registry.byCategory('category1');
			expect(category1Tools).toHaveLength(2);
			expect(category1Tools.map((t) => t.name)).toEqual(['tool1', 'tool2']);
		});

		it('should return empty array for non-existent category', () => {
			const registry = createToolRegistry();
			registry.register(createMockTool('tool1', 'category1'));
			expect(registry.byCategory('nonexistent')).toHaveLength(0);
		});
	});

	describe('extend', () => {
		it('should create a new registry with tools from both registries', () => {
			const registry1 = createToolRegistry();
			registry1.register(createMockTool('tool1'));
			registry1.register(createMockTool('tool2'));

			const registry2 = createToolRegistry();
			registry2.register(createMockTool('tool3'));

			const combined = registry1.extend(registry2);
			expect(combined.all()).toHaveLength(3);
			expect(combined.get('tool1')).toBeDefined();
			expect(combined.get('tool2')).toBeDefined();
			expect(combined.get('tool3')).toBeDefined();
		});

		it('should not modify the original registries', () => {
			const registry1 = createToolRegistry();
			registry1.register(createMockTool('tool1'));

			const registry2 = createToolRegistry();
			registry2.register(createMockTool('tool2'));

			registry1.extend(registry2);
			expect(registry1.all()).toHaveLength(1);
			expect(registry2.all()).toHaveLength(1);
		});

		it('should prefer tools from the other registry when names conflict', () => {
			const registry1 = createToolRegistry();
			const tool1 = createMockTool('shared');
			registry1.register(tool1);

			const registry2 = createToolRegistry();
			const tool2 = createMockTool('shared');
			registry2.register(tool2);

			const combined = registry1.extend(registry2);
			expect(combined.get('shared')).toBe(tool2);
		});
	});
});
