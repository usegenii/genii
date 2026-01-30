/**
 * TUI command - launches the interactive terminal UI.
 * @module commands/tui
 */

import { Command } from 'commander';

/**
 * Command for launching the interactive TUI.
 */
export const tuiCommand = new Command('tui')
	.description('Launch interactive terminal UI')
	.option('--view <view>', 'Initial view to show (dashboard, agents, channels, logs)', 'dashboard')
	.option('--refresh <ms>', 'Refresh interval in milliseconds', '1000')
	.option('--no-color', 'Disable colors')
	.action(async (options) => {
		// TODO: Implement TUI launch
		// const { render } = await import('ink');
		// const { App } = await import('../tui/app');
		// render(<App initialView={options.view} refreshInterval={options.refresh} />);
		console.log('Launching TUI...', options);
	});
