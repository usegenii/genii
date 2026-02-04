/**
 * CommandExecutor for executing slash commands.
 *
 * The executor looks up commands in the registry and executes them
 * with the appropriate context.
 */

import type { Destination } from '@genii/comms/destination/types';
import type { Logger } from '../logging/logger';
import type { CommandRegistryInterface } from './registry';
import type { CommandResult, CommandServices } from './types';

/**
 * Configuration for the CommandExecutor.
 */
export interface CommandExecutorConfig {
	/** Command registry for looking up commands */
	registry: CommandRegistryInterface;
	/** Services to provide to command handlers */
	services: CommandServices;
	/** Logger for the executor */
	logger: Logger;
}

/**
 * Interface for executing slash commands.
 */
export interface CommandExecutorInterface {
	/**
	 * Execute a command.
	 *
	 * @param name - The command name (without leading slash)
	 * @param args - Arguments passed with the command
	 * @param destination - Where the command was received
	 * @returns The result of command execution
	 */
	execute(name: string, args: string, destination: Destination): Promise<CommandResult>;
}

/**
 * CommandExecutor executes slash commands by looking them up in the registry.
 */
export class CommandExecutor implements CommandExecutorInterface {
	private readonly _registry: CommandRegistryInterface;
	private readonly _services: CommandServices;
	private readonly _logger: Logger;

	constructor(config: CommandExecutorConfig) {
		this._registry = config.registry;
		this._services = config.services;
		this._logger = config.logger.child({ component: 'CommandExecutor' });
	}

	async execute(name: string, args: string, destination: Destination): Promise<CommandResult> {
		this._logger.debug({ command: name, args }, 'Executing command');

		// Look up the command
		const command = this._registry.get(name);
		if (!command) {
			this._logger.debug({ command: name }, 'Unknown command, forwarding to agent');
			return { type: 'forward' };
		}

		try {
			// Execute the command
			const result = await command.execute({
				destination,
				args,
				services: this._services,
			});

			this._logger.debug({ command: name, resultType: result.type }, 'Command executed');
			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this._logger.error({ error: errorMessage, command: name }, 'Command execution failed');

			return {
				type: 'error',
				error: `Command failed: ${errorMessage}`,
			};
		}
	}
}

/**
 * Create a new CommandExecutor instance.
 *
 * @param config - Configuration for the executor
 * @returns A new CommandExecutor
 */
export function createCommandExecutor(config: CommandExecutorConfig): CommandExecutor {
	return new CommandExecutor(config);
}
