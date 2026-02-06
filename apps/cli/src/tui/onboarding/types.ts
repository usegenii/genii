/**
 * Types for the onboarding wizard.
 * @module tui/onboarding/types
 */

import type { ChannelConfig } from '@genii/config/types/channel';
import type { ModelConfig } from '@genii/config/types/model';
import type { ProviderConfig } from '@genii/config/types/provider';

/**
 * Page identifiers for the wizard.
 */
export type PageId = 'disclaimer' | 'provider' | 'channels' | 'preferences' | 'pulse' | 'templates';

/**
 * Information about an existing configured provider.
 */
export interface ExistingProviderInfo {
	providerId: string;
	config: ProviderConfig;
	isBuiltin: boolean;
	hasStoredApiKey: boolean;
}

/**
 * Information about an existing configured model.
 */
export interface ExistingModelInfo {
	modelId: string;
	config: ModelConfig;
	providerId: string;
}

/**
 * State for a channel instance being configured in onboarding.
 */
export interface ChannelInstanceState {
	name: string;
	type: string;
	credential?: string;
	keepExistingCredential?: boolean;
	fieldValues: Record<string, string>;
	isExisting?: boolean;
}

/**
 * Information about an existing configured channel.
 */
export interface ExistingChannelInfo {
	name: string;
	config: ChannelConfig;
	hasStoredCredential: boolean;
}

/**
 * Existing configuration loaded from config files.
 */
export interface ExistingConfig {
	providers: ExistingProviderInfo[];
	models: ExistingModelInfo[];
	channels: ExistingChannelInfo[];
	/** Whether preferences.toml exists (indicates user has completed onboarding before) */
	hasExistingPreferences: boolean;
}

/**
 * Provider configuration in onboarding state (legacy single-provider).
 */
export interface ProviderState {
	type: 'builtin' | 'custom';
	builtinId?: string;
	apiKey?: string;
	custom?: {
		apiType: 'anthropic' | 'openai';
		baseUrl: string;
		apiKey?: string;
	};
	/** Tracks if editing an existing provider */
	existingProviderId?: string;
	/** Whether to preserve the stored API key */
	keepExistingApiKey?: boolean;
}

/**
 * State for a provider instance being configured in onboarding.
 * Each instance corresponds to one provider definition (one per type).
 */
export interface ProviderInstanceState {
	/** Provider definition ID used as unique key (e.g., "zai", "custom") */
	id: string;
	type: 'builtin' | 'custom';
	builtinId?: string;
	apiKey?: string;
	custom?: {
		apiType: 'anthropic' | 'openai';
		baseUrl: string;
		apiKey?: string;
	};
	keepExistingApiKey?: boolean;
	existingProviderId?: string;
	selectedModels: string[];
	isExisting?: boolean;
}

/**
 * Preferences configuration in onboarding state.
 */
export interface PreferencesState {
	logLevel: 'debug' | 'info' | 'warn' | 'error';
	shellTimeout: number;
	timezone?: string;
}

/**
 * Pulse configuration in onboarding state.
 */
export interface PulseState {
	enabled: boolean;
	interval: '15m' | '30m' | '1h' | '2h' | '4h' | '6h';
}

/**
 * Template configuration in onboarding state.
 */
export interface TemplatesState {
	overwriteMode: 'backup' | 'skip' | 'overwrite';
}

/**
 * Complete onboarding state.
 */
export interface OnboardingState {
	currentPage: number;
	disclaimerAccepted: boolean;
	/** Provider instances being configured */
	providers: ProviderInstanceState[];
	/** Providers that should be removed during completion */
	providersToRemove: string[];
	preferences: PreferencesState;
	pulse: PulseState;
	templates: TemplatesState;
	/** Channel instances being configured */
	channels: ChannelInstanceState[];
	/** Channels that should be removed during completion */
	channelsToRemove: string[];
	/** Existing configuration loaded from config files */
	existingConfig?: ExistingConfig;
}

/**
 * Props passed to each wizard page component.
 */
export interface WizardPageProps {
	state: OnboardingState;
	existingConfig?: ExistingConfig;
	onCommit: (updates: Partial<OnboardingState>) => void;
	onNext: () => void;
	onBack: () => void;
	onValidityChange: (canProceed: boolean) => void;
}

/**
 * Page info for rendering.
 */
export interface PageInfo {
	id: PageId;
	title: string;
	description: string;
}

/**
 * All pages in order.
 */
export const PAGES: PageInfo[] = [
	{ id: 'disclaimer', title: 'Disclaimer', description: 'Safety warning and acceptance' },
	{ id: 'provider', title: 'Provider & Model Setup', description: 'Configure AI providers and models' },
	{ id: 'channels', title: 'Channels', description: 'Configure messaging channels' },
	{ id: 'preferences', title: 'Preferences', description: 'General settings' },
	{ id: 'pulse', title: 'Pulse', description: 'Proactive work scheduling' },
	{ id: 'templates', title: 'Templates', description: 'Install guidance files' },
];

/**
 * Default initial state for the wizard.
 */
export const DEFAULT_STATE: OnboardingState = {
	currentPage: 0,
	disclaimerAccepted: false,
	providers: [],
	providersToRemove: [],
	preferences: {
		logLevel: 'info',
		shellTimeout: 30,
	},
	pulse: {
		enabled: true,
		interval: '30m',
	},
	templates: {
		overwriteMode: 'backup',
	},
	channels: [],
	channelsToRemove: [],
};
