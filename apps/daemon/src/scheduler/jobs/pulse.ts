/**
 * Pulse job implementation.
 *
 * A scheduled job that spawns agent sessions periodically, with configurable
 * response routing. Supports named destinations, lastActive, or silent mode.
 */

import type { Destination } from '@genii/comms/destination/types';
import type { ChannelRegistry } from '@genii/comms/registry/types';
import type { AgentAdapter } from '@genii/orchestrator/adapters/types';
import type { Coordinator } from '@genii/orchestrator/coordinator/types';
import type { AgentEvent, CoordinatorEvent } from '@genii/orchestrator/events/types';
import type { ToolRegistryInterface } from '@genii/orchestrator/tools/types';
import type { AgentSpawnConfig } from '@genii/orchestrator/types/core';
import type { Logger } from '../../logging/logger';
import type { DestinationResolver } from '../destination-resolver';
import type { ScheduledJob } from '../types';
import type { PulseJobConfig, PulseJobResult } from './types';

/**
 * Check if text contains the rest token indicating no response needed.
 */
function containsRestToken(text: string): boolean {
	return /<rest\s*\/?>/.test(text.trim());
}

/**
 * Configuration for creating a PulseJob.
 */
export interface PulseJobOptions {
	/** Pulse job configuration */
	config: PulseJobConfig;
	/** Coordinator for spawning agents */
	coordinator: Coordinator;
	/** Channel registry for sending responses */
	channelRegistry: ChannelRegistry;
	/** Destination resolver for routing responses */
	destinationResolver: DestinationResolver;
	/** Factory for creating agent adapters */
	adapterFactory: () => Promise<AgentAdapter>;
	/** Path to guidance directory */
	guidancePath: string;
	/** Tool registry for agents */
	toolRegistry?: ToolRegistryInterface;
	/** Logger instance */
	logger: Logger;
}

/**
 * Pulse job that spawns scheduled agent sessions.
 */
export class PulseJob implements ScheduledJob {
	readonly name = 'pulse';

	private readonly _config: PulseJobConfig;
	private readonly _coordinator: Coordinator;
	private readonly _channelRegistry: ChannelRegistry;
	private readonly _destinationResolver: DestinationResolver;
	private readonly _adapterFactory: () => Promise<AgentAdapter>;
	private readonly _guidancePath: string;
	private readonly _toolRegistry?: ToolRegistryInterface;
	private readonly _logger: Logger;

	constructor(options: PulseJobOptions) {
		this._config = options.config;
		this._coordinator = options.coordinator;
		this._channelRegistry = options.channelRegistry;
		this._destinationResolver = options.destinationResolver;
		this._adapterFactory = options.adapterFactory;
		this._guidancePath = options.guidancePath;
		this._toolRegistry = options.toolRegistry;
		this._logger = options.logger.child({ component: 'PulseJob' });
	}

	/**
	 * Execute the pulse job.
	 * Spawns an agent session and routes the response if configured.
	 */
	async execute(): Promise<void> {
		const result = await this._executePulse();

		if (result.success) {
			this._logger.info(
				{
					sessionId: result.sessionId,
					suppressed: result.suppressed,
					hasResponse: !!result.response,
				},
				'Pulse completed successfully',
			);
		} else {
			this._logger.error({ error: result.error }, 'Pulse execution failed');
		}
	}

	/**
	 * Execute the pulse and return detailed result.
	 */
	private async _executePulse(): Promise<PulseJobResult> {
		try {
			// Resolve the response destination
			const { destination, resolution } = this._destinationResolver.resolve(this._config.responseTo);
			const hasResponseDestination = destination !== null;

			this._logger.debug(
				{
					resolution,
					hasDestination: hasResponseDestination,
					channelId: destination?.channelId,
				},
				'Resolved pulse destination',
			);

			// Create spawn config with pulse session metadata
			const spawnConfig: AgentSpawnConfig = {
				guidancePath: this._guidancePath,
				tags: ['pulse', 'scheduled'],
				metadata: {
					isPulse: true,
					hasResponseDestination,
					pulsePromptPath: this._config.promptPath,
				},
				tools: this._toolRegistry,
				// Provide an initial input to trigger the agent - actual instructions are in system context
				input: {
					message:
						'Follow your PULSE instructions strictly. Do not infer or repeat old tasks from prior sessions. If nothing needs attention, reply with <rest />',
				},
			};

			// Create adapter and spawn agent
			const adapter = await this._adapterFactory();
			const handle = await this._coordinator.spawn(adapter, spawnConfig);
			handle.start();

			this._logger.debug({ sessionId: handle.id }, 'Spawned pulse agent');

			// Collect the response by waiting for completion
			const response = await this._collectResponse(handle.id);

			// Check for rest token
			if (response && containsRestToken(response)) {
				this._logger.debug({ sessionId: handle.id }, 'Response contains rest token, suppressing');
				return {
					success: true,
					sessionId: handle.id,
					response,
					suppressed: true,
				};
			}

			// Route the response if we have a destination and content
			if (destination && response && response.trim()) {
				await this._sendResponse(destination, response);
				return {
					success: true,
					sessionId: handle.id,
					response,
					suppressed: false,
				};
			}

			// Silent mode or empty response
			return {
				success: true,
				sessionId: handle.id,
				response,
				suppressed: !response?.trim(),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: message,
			};
		}
	}

	/**
	 * Collect the final response from an agent session.
	 */
	private async _collectResponse(sessionId: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			let outputBuffer = '';
			let resolved = false;

			const unsubscribe = this._coordinator.subscribe((event: CoordinatorEvent) => {
				if (resolved) return;

				if (event.type === 'agent_event' && event.sessionId === sessionId) {
					const agentEvent = event.event as AgentEvent;

					// Collect output events
					if (agentEvent.type === 'output') {
						outputBuffer += agentEvent.text;
					}

					// Resolve on done event
					if (agentEvent.type === 'done') {
						resolved = true;
						unsubscribe();
						resolve(outputBuffer || undefined);
					}

					// Resolve on error event (fatal)
					if (agentEvent.type === 'error' && agentEvent.fatal) {
						resolved = true;
						unsubscribe();
						resolve(undefined);
					}
				}

				// Also check for agent_done at coordinator level
				if (event.type === 'agent_done' && event.sessionId === sessionId) {
					if (!resolved) {
						resolved = true;
						unsubscribe();
						resolve(outputBuffer || undefined);
					}
				}
			});

			// Timeout after 10 minutes
			setTimeout(
				() => {
					if (!resolved) {
						resolved = true;
						unsubscribe();
						this._logger.warn({ sessionId }, 'Pulse agent timed out after 10 minutes');
						resolve(outputBuffer || undefined);
					}
				},
				10 * 60 * 1000,
			);
		});
	}

	/**
	 * Send a response to a destination channel.
	 */
	private async _sendResponse(destination: Destination, text: string): Promise<void> {
		try {
			await this._channelRegistry.process(destination.channelId, {
				type: 'agent_responding',
				destination: {
					channelId: destination.channelId,
					ref: destination.ref,
					metadata: {
						conversationType: 'direct',
					},
				},
				content: {
					type: 'text',
					text,
				},
			});

			this._logger.debug({ channelId: destination.channelId, ref: destination.ref }, 'Sent pulse response');
		} catch (error) {
			this._logger.error({ error, channelId: destination.channelId }, 'Failed to send pulse response');
			throw error;
		}
	}
}

/**
 * Create a pulse job.
 *
 * @param options - Pulse job configuration
 * @returns A PulseJob instance
 */
export function createPulseJob(options: PulseJobOptions): PulseJob {
	return new PulseJob(options);
}
