/**
 * Provider capabilities and thinking level resolution.
 */

import type { ThinkingLevel } from '@geniigotchi/config/types/model';
import type { ProviderType } from './types';

/**
 * Capability definition for a provider.
 */
export interface ProviderCapabilities {
	/** Supported thinking levels (empty array means thinking is not supported) */
	supportedThinkingLevels: ThinkingLevel[];
	/** Default thinking level when not specified */
	defaultThinkingLevel: ThinkingLevel;
}

/**
 * Provider capabilities map.
 */
const PROVIDER_CAPABILITIES: Record<ProviderType, ProviderCapabilities> = {
	anthropic: {
		supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
		defaultThinkingLevel: 'medium',
	},
	openai: {
		supportedThinkingLevels: ['off'],
		defaultThinkingLevel: 'off',
	},
	google: {
		supportedThinkingLevels: ['off'],
		defaultThinkingLevel: 'off',
	},
};

/**
 * Get capabilities for a provider.
 * @param provider - Provider type
 * @returns Provider capabilities
 */
export function getProviderCapabilities(provider: ProviderType): ProviderCapabilities {
	return PROVIDER_CAPABILITIES[provider];
}

/**
 * Check if a provider supports a specific thinking level.
 * @param provider - Provider type
 * @param level - Thinking level to check
 * @returns true if the provider supports this thinking level
 */
export function supportsThinkingLevel(provider: ProviderType, level: ThinkingLevel): boolean {
	const capabilities = PROVIDER_CAPABILITIES[provider];
	return capabilities.supportedThinkingLevels.includes(level);
}

/**
 * Resolve the effective thinking level for a provider.
 *
 * Priority chain (highest to lowest):
 * 1. Session override (if specified and supported)
 * 2. Model config (if specified and supported)
 * 3. Provider default
 *
 * If a requested level is not supported, falls back to 'off'.
 *
 * @param provider - Provider type
 * @param modelConfigLevel - Thinking level from model configuration
 * @param sessionOverride - Session-level thinking level override
 * @returns The resolved thinking level
 */
export function resolveThinkingLevel(
	provider: ProviderType,
	modelConfigLevel?: ThinkingLevel,
	sessionOverride?: ThinkingLevel,
): ThinkingLevel {
	const capabilities = PROVIDER_CAPABILITIES[provider];

	// Priority 1: Session override
	if (sessionOverride !== undefined) {
		if (supportsThinkingLevel(provider, sessionOverride)) {
			return sessionOverride;
		}
		// Session override not supported, fall back to 'off'
		return 'off';
	}

	// Priority 2: Model config
	if (modelConfigLevel !== undefined) {
		if (supportsThinkingLevel(provider, modelConfigLevel)) {
			return modelConfigLevel;
		}
		// Model config level not supported, fall back to 'off'
		return 'off';
	}

	// Priority 3: Provider default
	return capabilities.defaultThinkingLevel;
}

/**
 * Validate that a string is a valid provider type.
 * @param type - String to validate
 * @returns true if the string is a valid provider type
 */
export function isValidProviderType(type: string): type is ProviderType {
	return type === 'anthropic' || type === 'openai' || type === 'google';
}
