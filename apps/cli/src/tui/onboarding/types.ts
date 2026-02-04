/**
 * Types for the onboarding wizard.
 * @module tui/onboarding/types
 */

/**
 * Page identifiers for the wizard.
 */
export type PageId = 'disclaimer' | 'provider' | 'models' | 'preferences' | 'pulse' | 'templates';

/**
 * Provider configuration in onboarding state.
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
	provider: ProviderState;
	selectedModels: string[];
	preferences: PreferencesState;
	pulse: PulseState;
	templates: TemplatesState;
}

/**
 * Actions for the wizard reducer.
 */
export type WizardAction =
	| { type: 'SET_PAGE'; page: number }
	| { type: 'NEXT_PAGE' }
	| { type: 'PREV_PAGE' }
	| { type: 'SET_DISCLAIMER_ACCEPTED'; accepted: boolean }
	| { type: 'SET_PROVIDER'; provider: ProviderState }
	| { type: 'SET_MODELS'; models: string[] }
	| { type: 'SET_PREFERENCES'; preferences: Partial<PreferencesState> }
	| { type: 'SET_PULSE'; pulse: Partial<PulseState> }
	| { type: 'SET_TEMPLATES'; templates: Partial<TemplatesState> }
	| { type: 'LOAD_STATE'; state: OnboardingState };

/**
 * Context value for the wizard.
 */
export interface WizardContextValue {
	state: OnboardingState;
	dispatch: React.Dispatch<WizardAction>;
	canGoNext: boolean;
	canGoBack: boolean;
	isComplete: boolean;
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
	{ id: 'provider', title: 'Provider Setup', description: 'Configure your AI provider' },
	{ id: 'models', title: 'Model Selection', description: 'Choose models to use' },
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
	provider: {
		type: 'builtin',
	},
	selectedModels: [],
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
};
