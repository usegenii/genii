/**
 * Tool registry implementation.
 */

import { type Logger, noopLogger } from '../types/logger.js';
import type { Tool, ToolRegistryInterface } from './types';

/**
 * Options for creating a tool registry.
 */
export interface ToolRegistryOptions {
	/** Logger for registration events */
	logger?: Logger;
}

/**
 * Registry for managing tools.
 */
export class ToolRegistry implements ToolRegistryInterface {
	private tools = new Map<string, Tool<unknown, unknown>>();
	private logger: Logger;

	constructor(options: ToolRegistryOptions = {}) {
		this.logger = options.logger ?? noopLogger;
	}

	/**
	 * Register a tool.
	 * Throws if a tool with the same name already exists.
	 */
	register<TInput, TOutput>(tool: Tool<TInput, TOutput>): void {
		if (this.tools.has(tool.name)) {
			throw new Error(`Tool "${tool.name}" is already registered`);
		}
		this.tools.set(tool.name, tool as Tool<unknown, unknown>);
		this.logger.info({ tool: tool.name, category: tool.category }, `Registered tool: ${tool.name}`);
	}

	/**
	 * Get a tool by name.
	 */
	get(name: string): Tool<unknown, unknown> | undefined {
		return this.tools.get(name);
	}

	/**
	 * Get all registered tools.
	 */
	all(): Tool<unknown, unknown>[] {
		return [...this.tools.values()];
	}

	/**
	 * Get tools by category.
	 */
	byCategory(category: string): Tool<unknown, unknown>[] {
		return [...this.tools.values()].filter((t) => t.category === category);
	}

	/**
	 * Check if a tool is registered.
	 */
	has(name: string): boolean {
		return this.tools.has(name);
	}

	/**
	 * Remove a tool by name.
	 */
	unregister(name: string): boolean {
		return this.tools.delete(name);
	}

	/**
	 * Get the number of registered tools.
	 */
	get size(): number {
		return this.tools.size;
	}

	/**
	 * Get all categories.
	 */
	categories(): string[] {
		const categories = new Set<string>();
		for (const tool of this.tools.values()) {
			if (tool.category) {
				categories.add(tool.category);
			}
		}
		return [...categories];
	}

	/**
	 * Create a new registry that includes tools from both registries.
	 * Tools in the other registry take precedence over this registry.
	 * Note: Does not log tool additions since tools are being copied, not newly registered.
	 */
	extend(other: ToolRegistryInterface): ToolRegistryInterface {
		const extended = new ToolRegistry({ logger: this.logger });

		// Add all tools from this registry (direct set, no logging)
		for (const tool of this.tools.values()) {
			extended.tools.set(tool.name, tool);
		}

		// Add/override with tools from other registry (direct set, no logging)
		for (const tool of other.all()) {
			extended.tools.set(tool.name, tool);
		}

		return extended;
	}

	/**
	 * Create a shallow copy of this registry.
	 * Note: Does not log tool additions since tools are being copied, not newly registered.
	 */
	clone(): ToolRegistry {
		const cloned = new ToolRegistry({ logger: this.logger });
		for (const tool of this.tools.values()) {
			cloned.tools.set(tool.name, tool);
		}
		return cloned;
	}

	/**
	 * Clear all registered tools.
	 */
	clear(): void {
		this.tools.clear();
	}
}

/**
 * Create an empty tool registry.
 */
export function createToolRegistry(options?: ToolRegistryOptions): ToolRegistry {
	return new ToolRegistry(options);
}

/**
 * Create a tool registry with the given tools.
 */
export function createToolRegistryWith(options: ToolRegistryOptions, ...tools: Tool<unknown, unknown>[]): ToolRegistry {
	const registry = new ToolRegistry(options);
	for (const tool of tools) {
		registry.register(tool);
	}
	return registry;
}
