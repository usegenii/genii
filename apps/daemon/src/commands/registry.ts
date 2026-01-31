/**
 * CommandRegistry for managing slash commands.
 *
 * The registry stores command definitions and provides lookup by name.
 */

import type { CommandDefinition, SlashCommand } from './types';

/**
 * Registry interface for managing slash commands.
 */
export interface CommandRegistryInterface {
	/**
	 * Register a command.
	 *
	 * @param command - The command to register
	 */
	register(command: SlashCommand): void;

	/**
	 * Get a command by name.
	 *
	 * @param name - The command name (without leading slash)
	 * @returns The command or undefined if not found
	 */
	get(name: string): SlashCommand | undefined;

	/**
	 * Get all command definitions for platform registration.
	 *
	 * @returns Array of command definitions (name and description)
	 */
	definitions(): CommandDefinition[];

	/**
	 * Check if a command is registered.
	 *
	 * @param name - The command name to check
	 * @returns True if the command exists
	 */
	has(name: string): boolean;
}

/**
 * CommandRegistry stores and provides access to slash commands.
 */
export class CommandRegistry implements CommandRegistryInterface {
	private readonly _commands: Map<string, SlashCommand> = new Map();

	register(command: SlashCommand): void {
		if (this._commands.has(command.name)) {
			throw new Error(`Command '${command.name}' is already registered`);
		}
		this._commands.set(command.name, command);
	}

	get(name: string): SlashCommand | undefined {
		return this._commands.get(name);
	}

	definitions(): CommandDefinition[] {
		return Array.from(this._commands.values()).map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
		}));
	}

	has(name: string): boolean {
		return this._commands.has(name);
	}
}

/**
 * Create a new CommandRegistry instance.
 *
 * @returns A new CommandRegistry
 */
export function createCommandRegistry(): CommandRegistry {
	return new CommandRegistry();
}
