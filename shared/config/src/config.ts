import { homedir } from 'node:os';
import { join } from 'node:path';
import { type ChannelsLoadResult, loadChannelsConfig } from './loaders/channels.js';
import { loadModelsConfig } from './loaders/models.js';
import { loadPreferencesConfig } from './loaders/preferences.js';
import { loadProvidersConfig } from './loaders/providers.js';
import type { ChannelConfig, ChannelsConfig } from './types/channel.js';
import type { ModelConfig } from './types/model.js';
import type { PreferencesConfig } from './types/preferences.js';
import type { ProviderConfig } from './types/provider.js';

/**
 * Default base path for configuration files
 */
const DEFAULT_BASE_PATH = join(homedir(), '.config', 'geniigotchi');

/**
 * Options for loading configuration
 */
export interface ConfigOptions {
	basePath?: string;
}

/**
 * Main configuration class providing typed access to all configuration sections.
 * This is a pure data container - secret resolution and environment preparation
 * should be handled by the orchestrator or other consuming code.
 */
export class Config {
	private readonly providers: Record<string, ProviderConfig>;
	private readonly models: Record<string, ModelConfig>;
	private readonly channelsData: ChannelsLoadResult;
	private readonly preferences: PreferencesConfig;

	constructor(
		providers: Record<string, ProviderConfig>,
		models: Record<string, ModelConfig>,
		channelsData: ChannelsLoadResult,
		preferences: PreferencesConfig,
	) {
		this.providers = providers;
		this.models = models;
		this.channelsData = channelsData;
		this.preferences = preferences;
	}

	/**
	 * Get all provider configurations
	 */
	getProviders(): Record<string, ProviderConfig> {
		return this.providers;
	}

	/**
	 * Get a specific provider configuration by name
	 */
	getProvider(name: string): ProviderConfig | undefined {
		return this.providers[name];
	}

	/**
	 * Get all model configurations
	 */
	getModels(): Record<string, ModelConfig> {
		return this.models;
	}

	/**
	 * Get a specific model configuration by name
	 */
	getModel(name: string): ModelConfig | undefined {
		return this.models[name];
	}

	/**
	 * Get global channel settings
	 */
	getChannelSettings(): ChannelsConfig {
		return this.channelsData.settings;
	}

	/**
	 * Get all channel configurations
	 */
	getChannels(): Record<string, ChannelConfig> {
		return this.channelsData.channels;
	}

	/**
	 * Get a specific channel configuration by name
	 */
	getChannel(name: string): ChannelConfig | undefined {
		return this.channelsData.channels[name];
	}

	/**
	 * Get preferences configuration
	 */
	getPreferences(): PreferencesConfig {
		return this.preferences;
	}
}

/**
 * Create a Config instance with the given loaded data
 */
export function createConfig(
	providers: Record<string, ProviderConfig>,
	models: Record<string, ModelConfig>,
	channelsData: ChannelsLoadResult,
	preferences: PreferencesConfig,
): Config {
	return new Config(providers, models, channelsData, preferences);
}

/**
 * Load configuration from disk
 *
 * @param options - Configuration options
 * @returns A Config instance with all loaded configuration
 *
 * @example
 * const config = await loadConfig();
 * const config = await loadConfig({ basePath: '/custom/path' });
 */
export async function loadConfig(options: ConfigOptions = {}): Promise<Config> {
	const basePath = options.basePath ?? DEFAULT_BASE_PATH;

	// Load all configuration files in parallel
	const [providers, models, channelsData, preferences] = await Promise.all([
		loadProvidersConfig(basePath),
		loadModelsConfig(basePath),
		loadChannelsConfig(basePath),
		loadPreferencesConfig(basePath),
	]);

	return createConfig(providers, models, channelsData, preferences);
}
