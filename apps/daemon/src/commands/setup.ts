/**
 * Command system setup.
 *
 * Bootstrap function to create the command registry and register all commands.
 */

import type { Logger } from '../logging/logger';
import { type CommandExecutorInterface, createCommandExecutor } from './executor';
import { allCommands } from './handlers/all';
import { type CommandRegistryInterface, createCommandRegistry } from './registry';
import type { CommandServices } from './types';

/**
 * Result of setting up the command system.
 */
export interface CommandSystemSetup {
	/** The command registry with all commands registered */
	registry: CommandRegistryInterface;
	/** The command executor for running commands */
	executor: CommandExecutorInterface;
}

/**
 * Set up the command system.
 *
 * Creates the registry, registers all commands, and creates the executor.
 *
 * @param services - Services to provide to command handlers
 * @param logger - Logger for the command system
 * @returns The registry and executor
 */
export function setupCommandSystem(services: CommandServices, logger: Logger): CommandSystemSetup {
	const setupLogger = logger.child({ component: 'CommandSetup' });

	// Create registry
	const registry = createCommandRegistry();

	// Register all commands
	for (const command of allCommands) {
		registry.register(command);
		setupLogger.debug({ command: command.name }, 'Registered command');
	}

	setupLogger.info({ commandCount: allCommands.length }, 'Command registry initialized');

	// Create executor
	const executor = createCommandExecutor({
		registry,
		services,
		logger,
	});

	return { registry, executor };
}
