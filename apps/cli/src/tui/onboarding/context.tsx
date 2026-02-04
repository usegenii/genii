/**
 * React context for wizard state management.
 * @module tui/onboarding/context
 */

import React, { createContext, type ReactNode, useContext, useReducer } from 'react';
import { DEFAULT_STATE, type OnboardingState, PAGES, type WizardAction, type WizardContextValue } from './types';

/**
 * Reducer for wizard state.
 */
function wizardReducer(state: OnboardingState, action: WizardAction): OnboardingState {
	switch (action.type) {
		case 'SET_PAGE':
			return { ...state, currentPage: action.page };
		case 'NEXT_PAGE':
			return { ...state, currentPage: Math.min(state.currentPage + 1, PAGES.length - 1) };
		case 'PREV_PAGE':
			return { ...state, currentPage: Math.max(state.currentPage - 1, 0) };
		case 'SET_DISCLAIMER_ACCEPTED':
			return { ...state, disclaimerAccepted: action.accepted };
		case 'SET_PROVIDER':
			return { ...state, provider: action.provider };
		case 'SET_MODELS':
			return { ...state, selectedModels: action.models };
		case 'SET_PREFERENCES':
			return { ...state, preferences: { ...state.preferences, ...action.preferences } };
		case 'SET_PULSE':
			return { ...state, pulse: { ...state.pulse, ...action.pulse } };
		case 'SET_TEMPLATES':
			return { ...state, templates: { ...state.templates, ...action.templates } };
		case 'LOAD_STATE':
			return action.state;
		default:
			return state;
	}
}

/**
 * Check if the current page is valid to proceed.
 */
function canProceed(state: OnboardingState): boolean {
	const pageId = PAGES[state.currentPage]?.id;
	switch (pageId) {
		case 'disclaimer':
			return state.disclaimerAccepted;
		case 'provider':
			return state.provider.type === 'builtin'
				? Boolean(state.provider.builtinId && state.provider.apiKey)
				: Boolean(state.provider.custom?.baseUrl && state.provider.custom?.apiKey);
		case 'models':
			return state.selectedModels.length > 0;
		case 'preferences':
			return true; // Always valid
		case 'pulse':
			return true; // Always valid
		case 'templates':
			return true; // Always valid
		default:
			return false;
	}
}

const WizardContext = createContext<WizardContextValue | null>(null);

/**
 * Provider component for wizard context.
 */
export function WizardProvider({
	children,
	initialState = DEFAULT_STATE,
}: {
	children: ReactNode;
	initialState?: OnboardingState;
}): React.ReactElement {
	const [state, dispatch] = useReducer(wizardReducer, initialState);

	const value: WizardContextValue = {
		state,
		dispatch,
		canGoNext: canProceed(state) && state.currentPage < PAGES.length - 1,
		canGoBack: state.currentPage > 0,
		isComplete: state.currentPage === PAGES.length - 1,
	};

	return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

/**
 * Hook to access wizard context.
 * @throws If used outside WizardProvider
 */
export function useWizard(): WizardContextValue {
	const context = useContext(WizardContext);
	if (!context) {
		throw new Error('useWizard must be used within a WizardProvider');
	}
	return context;
}
