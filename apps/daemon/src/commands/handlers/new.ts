/**
 * /new command handler.
 *
 * Resets the conversation by stopping any running agent and unbinding the session.
 */

import type { SlashCommand } from '../types';

/**
 * The /new command starts a fresh conversation.
 *
 * It:
 * 1. Gets the current binding for the destination
 * 2. If an agent exists, terminates it
 * 3. Unbinds the destination so the next message spawns a new agent
 */
export const newCommand: SlashCommand = {
	name: 'new',
	description: 'Start a fresh conversation',
	async execute(ctx) {
		const { destination, services } = ctx;
		const { logger } = services;

		logger.debug({ destination: `${destination.channelId}:${destination.ref}` }, 'Executing /new command');

		// Get existing binding for this destination
		const binding = services.conversations.getByDestination(destination);

		// Terminate the agent if one is bound
		if (binding?.agentId) {
			const handle = services.coordinator.get(binding.agentId);
			if (handle) {
				logger.info({ agentId: binding.agentId }, 'Terminating agent for /new command');
				await handle.terminate('User requested new conversation');
			}
		}

		// Unbind the destination
		services.conversations.unbind(destination);

		logger.info({ destination: `${destination.channelId}:${destination.ref}` }, 'Conversation reset via /new');

		return {
			type: 'handled',
			response: 'Starting fresh. Send a message to begin.',
		};
	},
};
