/**
 * Main entry point for the genii CLI.
 * Sets up the Commander program with all command groups.
 * @module index
 */

import { Command } from 'commander';
import { registerAgentCommands } from './commands/agent/list';
import { registerChannelCommands } from './commands/channel/list';
import { registerConfigCommands } from './commands/config/show';
import { registerConversationCommands } from './commands/conversation/list';
import { registerDaemonCommands } from './commands/daemon/start';
import { registerOnboardCommand } from './commands/onboard';
import { registerPulseCommand } from './commands/pulse';
import { tuiCommand } from './commands/tui';

export const program = new Command();

program.name('genii').description('CLI for managing the Genii daemon and agents').version('0.0.1');

// Global options
program
	.option('-o, --output <format>', 'Output format: human, json, quiet', 'human')
	.option('-v, --verbose', 'Enable verbose output')
	.option('-q, --quiet', 'Suppress non-essential output');

// Register command groups
registerDaemonCommands(program);
registerAgentCommands(program);
registerChannelCommands(program);
registerConversationCommands(program);
registerConfigCommands(program);

// Top-level commands
registerOnboardCommand(program);
registerPulseCommand(program);

// TUI command
program.addCommand(tuiCommand);
