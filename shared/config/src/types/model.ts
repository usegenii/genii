import { type Static, Type } from '@sinclair/typebox';

export const ModelConfigSchema = Type.Object({
	provider: Type.String({ description: 'References a provider name' }),
	modelId: Type.String({ description: 'The model identifier' }),
});

export type ModelConfig = Static<typeof ModelConfigSchema>;
