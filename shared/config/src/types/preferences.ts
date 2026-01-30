import { type Static, Type } from '@sinclair/typebox';

export const AgentPreferencesSchema = Type.Object({
	defaultModels: Type.Array(Type.String(), { description: 'Array of model names' }),
});

export type AgentPreferences = Static<typeof AgentPreferencesSchema>;

export const LoggingPreferencesSchema = Type.Object({
	level: Type.Union([Type.Literal('debug'), Type.Literal('info'), Type.Literal('warn'), Type.Literal('error')]),
});

export type LoggingPreferences = Static<typeof LoggingPreferencesSchema>;

export const PreferencesConfigSchema = Type.Object({
	agents: AgentPreferencesSchema,
	logging: LoggingPreferencesSchema,
});

export type PreferencesConfig = Static<typeof PreferencesConfigSchema>;
