/**
 * Core types for the slash command system.
 */

import type { Destination } from '@geniigotchi/comms/destination/types';
import type { Coordinator } from '@geniigotchi/orchestrator/coordinator/types';
import type { ConversationManager } from '../conversations/manager';
import type { Logger } from '../logging/logger';

/**
 * Services available to command handlers.
 */
export interface CommandServices {
	/** Coordinator for managing agents */
	coordinator: Coordinator;
	/** Conversation manager for bindings */
	conversations: ConversationManager;
	/** Logger for command handlers */
	logger: Logger;
}

/**
 * Context passed to command handlers.
 */
export interface CommandContext {
	/** The destination where the command was received */
	destination: Destination;
	/** Arguments passed with the command (text after the command name) */
	args: string;
	/** Services available to the handler */
	services: CommandServices;
}

/**
 * Result of executing a command.
 */
export type CommandResult = CommandResultHandled | CommandResultForward | CommandResultSilent | CommandResultError;

/**
 * Command was handled successfully.
 */
export interface CommandResultHandled {
	type: 'handled';
	/** Optional response message to send back */
	response?: string;
}

/**
 * Command should be forwarded to the agent as a regular message.
 */
export interface CommandResultForward {
	type: 'forward';
}

/**
 * Command was handled silently (no response needed).
 */
export interface CommandResultSilent {
	type: 'silent';
}

/**
 * Command execution failed.
 */
export interface CommandResultError {
	type: 'error';
	/** Error message to display to the user */
	error: string;
}

/**
 * Handler function for a command.
 */
export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;

/**
 * Full definition of a slash command.
 */
export interface SlashCommand {
	/** Command name without the leading slash (e.g., 'new' for /new) */
	name: string;
	/** Description shown in platform command menus */
	description: string;
	/** The handler function */
	execute: CommandHandler;
}

/**
 * Command definition for platform registration.
 */
export interface CommandDefinition {
	/** Command name without the leading slash */
	name: string;
	/** Description shown in platform command menus */
	description: string;
}
