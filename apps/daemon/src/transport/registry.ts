/**
 * Transport registry for managing pluggable transport implementations.
 *
 * The registry provides:
 * - Registration of transport factories by type
 * - Creation of transport servers and clients
 * - Pluggable transport architecture
 */

import type {
	TransportRegistry as ITransportRegistry,
	TransportClient,
	TransportClientFactory,
	TransportClientOptions,
	TransportServer,
	TransportServerFactory,
	TransportServerOptions,
	TransportType,
} from './types';

/**
 * Error thrown when a transport type is not registered.
 */
export class TransportNotRegisteredError extends Error {
	readonly transportType: TransportType;

	constructor(type: TransportType, kind: 'server' | 'client') {
		super(`Transport ${kind} not registered for type: ${type}`);
		this.name = 'TransportNotRegisteredError';
		this.transportType = type;
	}
}

/**
 * Error thrown when a transport type is already registered.
 */
export class TransportAlreadyRegisteredError extends Error {
	readonly transportType: TransportType;

	constructor(type: TransportType, kind: 'server' | 'client') {
		super(`Transport ${kind} already registered for type: ${type}`);
		this.name = 'TransportAlreadyRegisteredError';
		this.transportType = type;
	}
}

/**
 * Implementation of TransportRegistry for managing transport factories.
 */
export class TransportRegistryImpl implements ITransportRegistry {
	private readonly _serverFactories: Map<TransportType, TransportServerFactory> = new Map();
	private readonly _clientFactories: Map<TransportType, TransportClientFactory> = new Map();

	/**
	 * Register a server factory for a transport type.
	 *
	 * @param type - The transport type
	 * @param factory - Factory function to create servers
	 * @throws TransportAlreadyRegisteredError if already registered
	 */
	registerServer(type: TransportType, factory: TransportServerFactory): void {
		if (this._serverFactories.has(type)) {
			throw new TransportAlreadyRegisteredError(type, 'server');
		}
		this._serverFactories.set(type, factory);
	}

	/**
	 * Register a client factory for a transport type.
	 *
	 * @param type - The transport type
	 * @param factory - Factory function to create clients
	 * @throws TransportAlreadyRegisteredError if already registered
	 */
	registerClient(type: TransportType, factory: TransportClientFactory): void {
		if (this._clientFactories.has(type)) {
			throw new TransportAlreadyRegisteredError(type, 'client');
		}
		this._clientFactories.set(type, factory);
	}

	/**
	 * Create a transport server.
	 *
	 * @param type - The transport type
	 * @param options - Server options
	 * @returns A new transport server instance
	 * @throws TransportNotRegisteredError if type not registered
	 */
	createServer(type: TransportType, options?: TransportServerOptions): TransportServer {
		const factory = this._serverFactories.get(type);
		if (!factory) {
			throw new TransportNotRegisteredError(type, 'server');
		}
		return factory(options);
	}

	/**
	 * Create a transport client.
	 *
	 * @param type - The transport type
	 * @param options - Client options
	 * @returns A new transport client instance
	 * @throws TransportNotRegisteredError if type not registered
	 */
	createClient(type: TransportType, options?: TransportClientOptions): TransportClient {
		const factory = this._clientFactories.get(type);
		if (!factory) {
			throw new TransportNotRegisteredError(type, 'client');
		}
		return factory(options);
	}

	/**
	 * Check if a server factory is registered for a type.
	 *
	 * @param type - The transport type
	 * @returns True if registered
	 */
	hasServer(type: TransportType): boolean {
		return this._serverFactories.has(type);
	}

	/**
	 * Check if a client factory is registered for a type.
	 *
	 * @param type - The transport type
	 * @returns True if registered
	 */
	hasClient(type: TransportType): boolean {
		return this._clientFactories.has(type);
	}

	/**
	 * Unregister a server factory.
	 *
	 * @param type - The transport type
	 * @returns True if was registered
	 */
	unregisterServer(type: TransportType): boolean {
		return this._serverFactories.delete(type);
	}

	/**
	 * Unregister a client factory.
	 *
	 * @param type - The transport type
	 * @returns True if was registered
	 */
	unregisterClient(type: TransportType): boolean {
		return this._clientFactories.delete(type);
	}

	/**
	 * Get all registered server transport types.
	 */
	getServerTypes(): TransportType[] {
		return Array.from(this._serverFactories.keys());
	}

	/**
	 * Get all registered client transport types.
	 */
	getClientTypes(): TransportType[] {
		return Array.from(this._clientFactories.keys());
	}

	/**
	 * Clear all registered factories.
	 */
	clear(): void {
		this._serverFactories.clear();
		this._clientFactories.clear();
	}
}

/**
 * Create a new transport registry.
 *
 * @returns A new TransportRegistryImpl instance
 */
export function createTransportRegistry(): TransportRegistryImpl {
	return new TransportRegistryImpl();
}

/**
 * Global default transport registry.
 */
let defaultRegistry: TransportRegistryImpl | null = null;

/**
 * Get the default transport registry.
 *
 * Creates a singleton instance on first call.
 *
 * @returns The default registry
 */
export function getDefaultRegistry(): TransportRegistryImpl {
	if (!defaultRegistry) {
		defaultRegistry = createTransportRegistry();
	}
	return defaultRegistry;
}

/**
 * Reset the default registry (mainly for testing).
 */
export function resetDefaultRegistry(): void {
	defaultRegistry = null;
}
