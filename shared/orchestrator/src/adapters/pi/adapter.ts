/**
 * Pi adapter implementation.
 */

import type { AgentCheckpoint } from '../../snapshot/types.js';
import type { AdapterCreateConfig, AgentAdapter, AgentInstance } from '../types.js';
import { createPiAgentInstance } from './instance.js';
import type { PiAdapterOptions } from './types.js';

/**
 * Pi adapter for creating and restoring agent instances.
 */
export class PiAgentAdapter implements AgentAdapter {
	readonly name = 'pi';
	private options: PiAdapterOptions;

	constructor(options: PiAdapterOptions) {
		this.options = options;
	}

	async create(config: AdapterCreateConfig): Promise<AgentInstance> {
		return createPiAgentInstance(config, {
			provider: this.options.provider,
			model: this.options.model,
			apiKey: this.options.apiKey,
			thinkingLevel: this.options.thinkingLevel,
			baseUrl: this.options.baseUrl,
		});
	}

	async restore(_checkpoint: AgentCheckpoint): Promise<AgentInstance> {
		throw new Error('PiAgentAdapter.restore() is not yet implemented');
	}
}

/**
 * Create a Pi adapter.
 */
export function createPiAdapter(options: PiAdapterOptions): PiAgentAdapter {
	return new PiAgentAdapter(options);
}
