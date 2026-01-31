/**
 * Tests for ContextInjectorRegistry.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../types/logger';
import { createContextInjectorRegistry } from './registry';
import type { ContextInjection, ContextInjector, InjectorContext } from './types';

// Helper to create a mock injector
function createMockInjector(
	name: string,
	options: { systemContext?: string; resumeMessages?: ContextInjection['resumeMessages'] } = {},
): ContextInjector {
	return {
		name,
		injectSystemContext: vi.fn(() => options.systemContext),
		injectResumeContext: vi.fn(() => options.resumeMessages),
	};
}

// Helper to create a mock context
function createMockContext(overrides: Partial<InjectorContext> = {}): InjectorContext {
	return {
		timezone: 'America/New_York',
		now: new Date('2025-01-15T12:00:00Z'),
		sessionId: 'test-session-123',
		...overrides,
	};
}

describe('ContextInjectorRegistry', () => {
	describe('createContextInjectorRegistry', () => {
		it('should create an empty registry', () => {
			const registry = createContextInjectorRegistry();
			expect(registry.all()).toHaveLength(0);
			expect(registry.size).toBe(0);
		});
	});

	describe('register', () => {
		it('should register a context injector', () => {
			const registry = createContextInjectorRegistry();
			const injector = createMockInjector('test-injector');

			registry.register(injector);

			expect(registry.all()).toHaveLength(1);
			expect(registry.get('test-injector')).toBe(injector);
			expect(registry.has('test-injector')).toBe(true);
		});

		it('should throw error for duplicate registration', () => {
			const registry = createContextInjectorRegistry();
			const injector1 = createMockInjector('duplicate');
			const injector2 = createMockInjector('duplicate');

			registry.register(injector1);

			expect(() => registry.register(injector2)).toThrow('Context injector "duplicate" is already registered');
		});

		it('should log when registering an injector', () => {
			const mockLogger: Logger = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				child: vi.fn(() => mockLogger),
			};
			const registry = createContextInjectorRegistry({ logger: mockLogger });
			const injector = createMockInjector('test-injector');

			registry.register(injector);

			expect(mockLogger.info).toHaveBeenCalledWith(
				{ injector: 'test-injector' },
				'Registered context injector: test-injector',
			);
		});
	});

	describe('get', () => {
		it('should return undefined for non-existent injector', () => {
			const registry = createContextInjectorRegistry();
			expect(registry.get('nonexistent')).toBeUndefined();
		});

		it('should return the registered injector', () => {
			const registry = createContextInjectorRegistry();
			const injector = createMockInjector('test');
			registry.register(injector);
			expect(registry.get('test')).toBe(injector);
		});
	});

	describe('has', () => {
		it('should return false for non-existent injector', () => {
			const registry = createContextInjectorRegistry();
			expect(registry.has('nonexistent')).toBe(false);
		});

		it('should return true for registered injector', () => {
			const registry = createContextInjectorRegistry();
			registry.register(createMockInjector('test'));
			expect(registry.has('test')).toBe(true);
		});
	});

	describe('unregister', () => {
		it('should remove a registered injector', () => {
			const registry = createContextInjectorRegistry();
			registry.register(createMockInjector('test'));

			const result = registry.unregister('test');

			expect(result).toBe(true);
			expect(registry.has('test')).toBe(false);
		});

		it('should return false for non-existent injector', () => {
			const registry = createContextInjectorRegistry();
			expect(registry.unregister('nonexistent')).toBe(false);
		});
	});

	describe('all', () => {
		it('should return all registered injectors', () => {
			const registry = createContextInjectorRegistry();
			registry.register(createMockInjector('injector1'));
			registry.register(createMockInjector('injector2'));
			registry.register(createMockInjector('injector3'));

			expect(registry.all()).toHaveLength(3);
		});
	});

	describe('clear', () => {
		it('should remove all injectors', () => {
			const registry = createContextInjectorRegistry();
			registry.register(createMockInjector('injector1'));
			registry.register(createMockInjector('injector2'));

			registry.clear();

			expect(registry.all()).toHaveLength(0);
			expect(registry.size).toBe(0);
		});
	});

	describe('collectSystemContext', () => {
		it('should return undefined from empty registry', () => {
			const registry = createContextInjectorRegistry();
			const ctx = createMockContext();

			const result = registry.collectSystemContext(ctx);

			expect(result).toBeUndefined();
		});

		it('should collect from a single injector', () => {
			const registry = createContextInjectorRegistry();
			const injector = createMockInjector('test', {
				systemContext: 'Test context',
			});
			registry.register(injector);
			const ctx = createMockContext();

			const result = registry.collectSystemContext(ctx);

			expect(result).toBe('Test context');
			expect(injector.injectSystemContext).toHaveBeenCalledWith(ctx);
		});

		it('should collect from multiple injectors', () => {
			const registry = createContextInjectorRegistry();
			registry.register(createMockInjector('injector1', { systemContext: 'Context 1' }));
			registry.register(createMockInjector('injector2', { systemContext: 'Context 2' }));
			const ctx = createMockContext();

			const result = registry.collectSystemContext(ctx);

			expect(result).toBeDefined();
		});

		it('should merge systemContext from multiple injectors with double newlines', () => {
			const registry = createContextInjectorRegistry();
			registry.register(createMockInjector('injector1', { systemContext: 'First context' }));
			registry.register(createMockInjector('injector2', { systemContext: 'Second context' }));
			registry.register(createMockInjector('injector3', { systemContext: 'Third context' }));
			const ctx = createMockContext();

			const result = registry.collectSystemContext(ctx);

			expect(result).toBe('First context\n\nSecond context\n\nThird context');
		});

		it('should skip empty systemContext values', () => {
			const registry = createContextInjectorRegistry();
			registry.register(createMockInjector('injector1', { systemContext: 'First' }));
			registry.register(createMockInjector('injector2', {})); // No systemContext
			registry.register(createMockInjector('injector3', { systemContext: 'Third' }));
			const ctx = createMockContext();

			const result = registry.collectSystemContext(ctx);

			expect(result).toBe('First\n\nThird');
		});

		it('should handle injector errors gracefully', () => {
			const mockLogger: Logger = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				child: vi.fn(() => mockLogger),
			};
			const registry = createContextInjectorRegistry({ logger: mockLogger });

			const failingInjector: ContextInjector = {
				name: 'failing',
				injectSystemContext: () => {
					throw new Error('Injector failed');
				},
				injectResumeContext: () => undefined,
			};
			registry.register(failingInjector);
			registry.register(createMockInjector('working', { systemContext: 'Works fine' }));
			const ctx = createMockContext();

			const result = registry.collectSystemContext(ctx);

			// Should still get the working injector's context
			expect(result).toBe('Works fine');
			// Should log the error
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.objectContaining({ injector: 'failing' }),
				expect.stringContaining('Error in context injector "failing".injectSystemContext'),
			);
		});

		it('should pass context to all injectors', () => {
			const registry = createContextInjectorRegistry();
			const injector1 = createMockInjector('injector1');
			const injector2 = createMockInjector('injector2');
			registry.register(injector1);
			registry.register(injector2);
			const ctx = createMockContext({ sessionId: 'custom-session' });

			registry.collectSystemContext(ctx);

			expect(injector1.injectSystemContext).toHaveBeenCalledWith(ctx);
			expect(injector2.injectSystemContext).toHaveBeenCalledWith(ctx);
		});
	});

	describe('collectResumeContext', () => {
		it('should return undefined from empty registry', () => {
			const registry = createContextInjectorRegistry();
			const ctx = createMockContext();

			const result = registry.collectResumeContext(ctx);

			expect(result).toBeUndefined();
		});

		it('should merge resumeMessages from multiple injectors by concatenating arrays', () => {
			const registry = createContextInjectorRegistry();
			registry.register(
				createMockInjector('injector1', {
					resumeMessages: [{ role: 'user', content: [{ type: 'text', text: 'Message 1' }], timestamp: 1000 }],
				}),
			);
			registry.register(
				createMockInjector('injector2', {
					resumeMessages: [
						{ role: 'user', content: [{ type: 'text', text: 'Message 2' }], timestamp: 2000 },
						{ role: 'assistant', content: [{ type: 'text', text: 'Message 3' }], timestamp: 3000 },
					],
				}),
			);
			const ctx = createMockContext();

			const result = registry.collectResumeContext(ctx);

			expect(result).toHaveLength(3);
			expect(result?.[0]?.content[0]).toEqual({ type: 'text', text: 'Message 1' });
			expect(result?.[1]?.content[0]).toEqual({ type: 'text', text: 'Message 2' });
			expect(result?.[2]?.content[0]).toEqual({ type: 'text', text: 'Message 3' });
		});

		it('should skip empty resumeMessages arrays', () => {
			const registry = createContextInjectorRegistry();
			registry.register(
				createMockInjector('injector1', {
					resumeMessages: [{ role: 'user', content: [{ type: 'text', text: 'Message 1' }], timestamp: 1000 }],
				}),
			);
			registry.register(createMockInjector('injector2', { resumeMessages: [] }));
			registry.register(
				createMockInjector('injector3', {
					resumeMessages: [{ role: 'user', content: [{ type: 'text', text: 'Message 2' }], timestamp: 2000 }],
				}),
			);
			const ctx = createMockContext();

			const result = registry.collectResumeContext(ctx);

			expect(result).toHaveLength(2);
		});

		it('should handle injector errors gracefully', () => {
			const mockLogger: Logger = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				child: vi.fn(() => mockLogger),
			};
			const registry = createContextInjectorRegistry({ logger: mockLogger });

			const failingInjector: ContextInjector = {
				name: 'failing',
				injectSystemContext: () => undefined,
				injectResumeContext: () => {
					throw new Error('Injector failed');
				},
			};
			registry.register(failingInjector);
			registry.register(
				createMockInjector('working', {
					resumeMessages: [{ role: 'user', content: [{ type: 'text', text: 'Works' }], timestamp: 1000 }],
				}),
			);
			const ctx = createMockContext();

			const result = registry.collectResumeContext(ctx);

			// Should still get the working injector's messages
			expect(result).toHaveLength(1);
			// Should log the error
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.objectContaining({ injector: 'failing' }),
				expect.stringContaining('Error in context injector "failing".injectResumeContext'),
			);
		});
	});

	describe('collect (deprecated)', () => {
		it('should call collectSystemContext when isResume is false', () => {
			const registry = createContextInjectorRegistry();
			registry.register(createMockInjector('test', { systemContext: 'Test context' }));
			const ctx = createMockContext();

			const result = registry.collect({ ...ctx, isResume: false });

			expect(result.systemContext).toBe('Test context');
			expect(result.resumeMessages).toBeUndefined();
		});

		it('should call collectResumeContext when isResume is true', () => {
			const registry = createContextInjectorRegistry();
			registry.register(
				createMockInjector('test', {
					resumeMessages: [
						{ role: 'user', content: [{ type: 'text', text: 'Resume msg' }], timestamp: 1000 },
					],
				}),
			);
			const ctx = createMockContext();

			const result = registry.collect({ ...ctx, isResume: true });

			expect(result.resumeMessages).toHaveLength(1);
			expect(result.systemContext).toBeUndefined();
		});
	});
});
