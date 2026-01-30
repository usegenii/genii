import { type Static, Type } from '@sinclair/typebox';

/**
 * Thinking level for models that support extended thinking/reasoning.
 */
export const ThinkingLevelSchema = Type.Union([
	Type.Literal('off'),
	Type.Literal('minimal'),
	Type.Literal('low'),
	Type.Literal('medium'),
	Type.Literal('high'),
]);

export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;

export const ModelConfigSchema = Type.Object({
	provider: Type.String({ description: 'References a provider name' }),
	modelId: Type.String({ description: 'The model identifier' }),
	thinkingLevel: Type.Optional(ThinkingLevelSchema),
});

export type ModelConfig = Static<typeof ModelConfigSchema>;
