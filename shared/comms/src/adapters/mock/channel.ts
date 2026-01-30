/**
 * Mock channel implementation for testing.
 */

import type { Channel, ChannelConfig } from '../../channel/types';
import { TypedEventEmitter } from '../../events/emitter';
import type {
	ChannelLifecycleEvent,
	InboundEvent,
	IntentProcessedConfirmation,
	OutboundIntent,
} from '../../events/types';
import type { ChannelId, ChannelStatus, Disposable } from '../../types/core';
import { generateChannelId } from '../../types/core';

/**
 * Configuration for mock channel.
 */
export interface MockChannelConfig extends ChannelConfig {
	/** Simulate processing delay in ms */
	processDelay?: number;
	/** Simulate errors for specific intent types */
	simulateErrors?: OutboundIntent['type'][];
}

/**
 * Recorded intent for assertions in tests.
 */
export interface RecordedIntent {
	intent: OutboundIntent;
	timestamp: number;
}

/**
 * Mock channel for testing.
 * Records all processed intents and allows simulating inbound events.
 */
export class MockChannel implements Channel {
	readonly id: ChannelId;
	readonly adapter = 'mock';

	private _status: ChannelStatus = 'disconnected';
	private _inboundEmitter = new TypedEventEmitter<InboundEvent>();
	private _lifecycleEmitter = new TypedEventEmitter<ChannelLifecycleEvent>();
	private _recordedIntents: RecordedIntent[] = [];
	private _config: MockChannelConfig;

	constructor(config: MockChannelConfig = {}) {
		this.id = config.id ?? generateChannelId();
		this._config = config;
	}

	get status(): ChannelStatus {
		return this._status;
	}

	/**
	 * Get all recorded intents for assertions.
	 */
	get recordedIntents(): readonly RecordedIntent[] {
		return this._recordedIntents;
	}

	/**
	 * Clear recorded intents.
	 */
	clearRecordedIntents(): void {
		this._recordedIntents = [];
	}

	/**
	 * Simulate an inbound event.
	 */
	simulateInboundEvent(event: InboundEvent): void {
		this._inboundEmitter.emit(event);
	}

	/**
	 * Simulate a lifecycle event.
	 */
	simulateLifecycleEvent(event: ChannelLifecycleEvent): void {
		this._lifecycleEmitter.emit(event);
	}

	/**
	 * Set the channel status (for testing).
	 */
	setStatus(status: ChannelStatus): void {
		this._status = status;
	}

	async process(intent: OutboundIntent): Promise<IntentProcessedConfirmation> {
		// Record the intent
		this._recordedIntents.push({
			intent,
			timestamp: Date.now(),
		});

		// Simulate delay if configured
		if (this._config.processDelay) {
			await new Promise((resolve) => setTimeout(resolve, this._config.processDelay));
		}

		// Simulate error if configured for this intent type
		if (this._config.simulateErrors?.includes(intent.type)) {
			return {
				intentType: intent.type,
				success: false,
				error: `Simulated error for ${intent.type}`,
				timestamp: Date.now(),
			};
		}

		return {
			intentType: intent.type,
			success: true,
			timestamp: Date.now(),
		};
	}

	async fetchMedia(_ref: string): Promise<ReadableStream<Uint8Array>> {
		// Return an empty stream for testing
		return new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47])); // PNG header
				controller.close();
			},
		});
	}

	subscribe(handler: (event: InboundEvent) => void): Disposable {
		return this._inboundEmitter.on(handler);
	}

	events(): AsyncIterable<InboundEvent> {
		return {
			[Symbol.asyncIterator]: () => this._inboundEmitter[Symbol.asyncIterator](),
		};
	}

	onLifecycle(handler: (event: ChannelLifecycleEvent) => void): Disposable {
		return this._lifecycleEmitter.on(handler);
	}

	async connect(): Promise<void> {
		this._status = 'connecting';
		// Simulate async connection
		await Promise.resolve();
		this._status = 'connected';
		this._lifecycleEmitter.emit({
			type: 'channel_connected',
			channelId: this.id,
			timestamp: Date.now(),
		});
	}

	async disconnect(): Promise<void> {
		this._status = 'disconnected';
		this._lifecycleEmitter.emit({
			type: 'channel_disconnected',
			channelId: this.id,
			timestamp: Date.now(),
		});
		this._inboundEmitter.complete();
		this._lifecycleEmitter.complete();
	}
}
