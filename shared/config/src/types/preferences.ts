import { type Static, Type } from '@sinclair/typebox';

export const ShellToolPreferencesSchema = Type.Object({
	defaultWorkingDir: Type.Optional(Type.String({ description: 'Default working directory for shell commands' })),
	defaultTimeout: Type.Optional(Type.Number({ description: 'Default timeout in ms', default: 30000 })),
	maxOutputLength: Type.Optional(Type.Number({ description: 'Maximum output length in characters', default: 50000 })),
});

export type ShellToolPreferences = Static<typeof ShellToolPreferencesSchema>;

export const ToolsPreferencesSchema = Type.Object({
	shell: Type.Optional(ShellToolPreferencesSchema),
});

export type ToolsPreferences = Static<typeof ToolsPreferencesSchema>;

export const AgentPreferencesSchema = Type.Object({
	defaultModels: Type.Array(Type.String(), { description: 'Array of model names' }),
	tools: Type.Optional(ToolsPreferencesSchema),
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
