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

// Scheduler configuration schemas (defined before PreferencesConfigSchema)

export const SchedulerDestinationSchema = Type.Object({
	channel: Type.String({ description: 'Channel type (e.g., "telegram")' }),
	ref: Type.String({ description: 'Channel-specific reference (e.g., chat ID)' }),
});

export type SchedulerDestination = Static<typeof SchedulerDestinationSchema>;

/** Default pulse schedule: every 30 minutes */
export const DEFAULT_PULSE_SCHEDULE = '*/30 * * * *';

export const PulseConfigSchema = Type.Object({
	schedule: Type.Optional(
		Type.String({
			description: `Cron expression for pulse schedule. Defaults to "${DEFAULT_PULSE_SCHEDULE}" (every 30 minutes)`,
		}),
	),
	promptPath: Type.Optional(
		Type.String({
			description: 'Absolute path to pulse prompt file. Defaults to {guidancePath}/PULSE.md',
		}),
	),
	responseTo: Type.Optional(
		Type.String({
			description: 'Named destination, "lastActive", or omit for silent mode',
		}),
	),
});

export type PulseConfig = Static<typeof PulseConfigSchema>;

export const SchedulerConfigSchema = Type.Object({
	enabled: Type.Boolean({ description: 'Whether the scheduler is enabled' }),
	pulse: Type.Optional(PulseConfigSchema),
	destinations: Type.Optional(
		Type.Record(Type.String(), SchedulerDestinationSchema, {
			description: 'Named destinations for routing responses',
		}),
	),
});

export type SchedulerConfig = Static<typeof SchedulerConfigSchema>;

export const PreferencesConfigSchema = Type.Object({
	agents: AgentPreferencesSchema,
	logging: LoggingPreferencesSchema,
	timezone: Type.Optional(Type.String({ description: 'User timezone (e.g., "America/New_York")' })),
	scheduler: Type.Optional(SchedulerConfigSchema),
});

export type PreferencesConfig = Static<typeof PreferencesConfigSchema>;
