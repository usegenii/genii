/**
 * Pi adapter implementation.
 */

import type { AgentCheckpoint } from '../../snapshot/types';
import type { AdapterCreateConfig, AgentAdapter, AgentInstance } from '../types';
import { createPiAgentInstance, createPiAgentInstanceFromCheckpoint } from './instance';
import type { PiAdapterOptions } from './types';

/**
 * Pi adapter for creating and restoring agent instances.
 */
export class PiAgentAdapter implements AgentAdapter {
	readonly name = 'pi';
	readonly modelProvider: string;
	readonly modelName: string;
	private options: PiAdapterOptions;

	constructor(options: PiAdapterOptions) {
		this.options = options;
		// Store user-defined identifiers for checkpointing
		this.modelProvider = options.userProviderName;
		this.modelName = options.userModelName;
	}

	async create(config: AdapterCreateConfig): Promise<AgentInstance> {
		return createPiAgentInstance(config, {
			providerType: this.options.providerType,
			userProviderName: this.options.userProviderName,
			modelId: this.options.modelId,
			apiKey: this.options.apiKey,
			thinkingLevel: this.options.thinkingLevel,
			baseUrl: this.options.baseUrl,
		});
	}

	async restore(checkpoint: AgentCheckpoint, config: AdapterCreateConfig): Promise<AgentInstance> {
		if (checkpoint.adapterName !== 'pi') {
			throw new Error(`Cannot restore checkpoint from adapter "${checkpoint.adapterName}" with Pi adapter`);
		}

		return createPiAgentInstanceFromCheckpoint(checkpoint, config, this.options);
	}
}

/**
 * Create a Pi adapter.
 */
export function createPiAdapter(options: PiAdapterOptions): PiAgentAdapter {
	return new PiAgentAdapter(options);
}
