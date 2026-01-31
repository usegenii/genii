/**
 * Context injector registry implementation.
 */

import { type Logger, noopLogger } from '../types/logger.js';
import type { ContextInjection, ContextInjector, InjectorContext } from './types';

/**
 * Options for creating a context injector registry.
 */
export interface ContextInjectorRegistryOptions {
	/** Logger for registration events */
	logger?: Logger;
}

/**
 * Registry for managing context injectors.
 */
export class ContextInjectorRegistry {
	private injectors = new Map<string, ContextInjector>();
	private logger: Logger;

	constructor(options: ContextInjectorRegistryOptions = {}) {
		this.logger = options.logger ?? noopLogger;
	}

	/**
	 * Register a context injector.
	 * Throws if an injector with the same name already exists.
	 */
	register(injector: ContextInjector): void {
		if (this.injectors.has(injector.name)) {
			throw new Error(`Context injector "${injector.name}" is already registered`);
		}
		this.injectors.set(injector.name, injector);
		this.logger.info({ injector: injector.name }, `Registered context injector: ${injector.name}`);
	}

	/**
	 * Get an injector by name.
	 */
	get(name: string): ContextInjector | undefined {
		return this.injectors.get(name);
	}

	/**
	 * Get all registered injectors.
	 */
	all(): ContextInjector[] {
		return [...this.injectors.values()];
	}

	/**
	 * Check if an injector is registered.
	 */
	has(name: string): boolean {
		return this.injectors.has(name);
	}

	/**
	 * Remove an injector by name.
	 */
	unregister(name: string): boolean {
		return this.injectors.delete(name);
	}

	/**
	 * Get the number of registered injectors.
	 */
	get size(): number {
		return this.injectors.size;
	}

	/**
	 * Collect system context from all registered injectors.
	 * Combines systemContext strings with double newlines.
	 * @param ctx - The injector context (without isResume flag)
	 * @returns Combined system context string, or undefined if none
	 */
	collectSystemContext(ctx: InjectorContext): string | undefined {
		const systemContextParts: string[] = [];

		for (const injector of this.injectors.values()) {
			try {
				const context = injector.injectSystemContext(ctx);
				if (context) {
					systemContextParts.push(context);
				}
			} catch (error) {
				this.logger.error(
					{ injector: injector.name, error },
					`Error in context injector "${injector.name}".injectSystemContext: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		return systemContextParts.length > 0 ? systemContextParts.join('\n\n') : undefined;
	}

	/**
	 * Collect resume messages from all registered injectors.
	 * Concatenates all resume messages arrays.
	 * @param ctx - The injector context (without isResume flag)
	 * @returns Combined resume messages array, or undefined if none
	 */
	collectResumeContext(ctx: InjectorContext): ContextInjection['resumeMessages'] {
		const allResumeMessages: NonNullable<ContextInjection['resumeMessages']> = [];

		for (const injector of this.injectors.values()) {
			try {
				const messages = injector.injectResumeContext(ctx);
				if (messages && messages.length > 0) {
					allResumeMessages.push(...messages);
				}
			} catch (error) {
				this.logger.error(
					{ injector: injector.name, error },
					`Error in context injector "${injector.name}".injectResumeContext: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		return allResumeMessages.length > 0 ? allResumeMessages : undefined;
	}

	/**
	 * Collect all injections from registered injectors.
	 * @deprecated Use collectSystemContext or collectResumeContext instead
	 * Combines systemContext strings with newlines and concatenates resumeMessages arrays.
	 */
	collect(ctx: InjectorContext & { isResume: boolean }): ContextInjection {
		const result: ContextInjection = {};

		if (ctx.isResume) {
			result.resumeMessages = this.collectResumeContext(ctx);
		} else {
			result.systemContext = this.collectSystemContext(ctx);
		}

		return result;
	}

	/**
	 * Clear all registered injectors.
	 */
	clear(): void {
		this.injectors.clear();
	}
}

/**
 * Create an empty context injector registry.
 */
export function createContextInjectorRegistry(options?: ContextInjectorRegistryOptions): ContextInjectorRegistry {
	return new ContextInjectorRegistry(options);
}
