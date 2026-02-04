/**
 * Main onboarding wizard orchestrator.
 * @module tui/onboarding/wizard
 */

import { Box, Text, useApp } from 'ink';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { completeOnboarding } from './complete';
import { WizardNav } from './components/wizard-nav';
import { useWizard, WizardProvider } from './context';
import { useTerminalTheme } from './hooks/use-terminal-theme';
import { useWizardKeyboard } from './hooks/use-wizard-keyboard';
import { DisclaimerPage } from './pages/disclaimer';
import { ModelSelectionPage } from './pages/model-selection';
import { PreferencesPage } from './pages/preferences';
import { ProviderSetupPage } from './pages/provider-setup';
import { PulsePage } from './pages/pulse';
import { TemplatesPage } from './pages/templates';
import { clearOnboardingState, hasOnboardingState, loadOnboardingState, saveOnboardingState } from './persistence';
import { DEFAULT_STATE, type OnboardingState, PAGES } from './types';

export interface OnboardingWizardProps {
	/** Base path for config files */
	configPath: string;
	/** Callback when setup is complete */
	onComplete?: () => void;
	/** Callback when setup is cancelled */
	onCancel?: () => void;
}

/**
 * Inner wizard content that uses context.
 */
function WizardContent({ configPath, onComplete, onCancel: _onCancel }: OnboardingWizardProps): React.ReactElement {
	const { exit } = useApp();
	const theme = useTerminalTheme();
	const { state, dispatch, canGoNext, canGoBack, isComplete } = useWizard();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Save state on every change
	useEffect(() => {
		saveOnboardingState(state).catch(console.error);
	}, [state]);

	const handleNext = useCallback(async () => {
		if (isComplete) {
			// Complete setup - write configs, store secrets, copy templates
			setIsSubmitting(true);
			try {
				const result = await completeOnboarding(state, configPath);
				if (!result.success) {
					throw new Error(result.error ?? 'Unknown error');
				}
				await clearOnboardingState();
				onComplete?.();
				exit();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
				setIsSubmitting(false);
			}
		} else if (canGoNext) {
			dispatch({ type: 'NEXT_PAGE' });
		}
	}, [isComplete, canGoNext, dispatch, onComplete, exit, state, configPath]);

	useWizardKeyboard({
		onNext: handleNext,
		// Don't handle escape at wizard level - pages handle their own back navigation
		enabled: !isSubmitting,
	});

	const renderPage = () => {
		const pageId = PAGES[state.currentPage]?.id;
		switch (pageId) {
			case 'disclaimer':
				return <DisclaimerPage />;
			case 'provider':
				return <ProviderSetupPage />;
			case 'models':
				return <ModelSelectionPage />;
			case 'preferences':
				return <PreferencesPage />;
			case 'pulse':
				return <PulsePage />;
			case 'templates':
				return <TemplatesPage />;
			default:
				return <Text color={theme.error}>Unknown page</Text>;
		}
	};

	return (
		<Box flexDirection="column" padding={1}>
			<WizardNav
				currentPage={state.currentPage}
				canGoBack={canGoBack}
				canGoNext={canGoNext}
				isComplete={isComplete}
			/>

			<Box marginY={1}>{renderPage()}</Box>

			{error && (
				<Box marginTop={1}>
					<Text color={theme.error}>Error: {error}</Text>
				</Box>
			)}

			{isSubmitting && (
				<Box marginTop={1}>
					<Text color={theme.primary}>Completing setup...</Text>
				</Box>
			)}
		</Box>
	);
}

/**
 * Main onboarding wizard component.
 */
export function OnboardingWizard(props: OnboardingWizardProps): React.ReactElement {
	const [initialState, setInitialState] = useState<OnboardingState | null>(null);
	const [showResume, setShowResume] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const theme = useTerminalTheme();

	useEffect(() => {
		async function checkForExistingState() {
			const hasState = await hasOnboardingState();
			if (hasState) {
				setShowResume(true);
			}
			setIsLoading(false);
		}
		checkForExistingState();
	}, []);

	const handleResume = useCallback(async () => {
		const state = await loadOnboardingState();
		if (state) {
			setInitialState(state);
		}
		setShowResume(false);
	}, []);

	const handleStartFresh = useCallback(async () => {
		await clearOnboardingState();
		setInitialState(DEFAULT_STATE);
		setShowResume(false);
	}, []);

	useWizardKeyboard({
		enabled: showResume,
		onNext: handleResume,
		onBack: handleStartFresh,
	});

	if (isLoading) {
		return (
			<Box padding={1}>
				<Text color={theme.muted}>Loading...</Text>
			</Box>
		);
	}

	if (showResume) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.primary} bold>
					Previous setup found
				</Text>
				<Text color={theme.hint}>Would you like to resume or start fresh?</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color={theme.label}>Press Enter to resume previous setup</Text>
					<Text color={theme.label}>Press Esc to start fresh</Text>
				</Box>
			</Box>
		);
	}

	return (
		<WizardProvider initialState={initialState ?? DEFAULT_STATE}>
			<WizardContent {...props} />
		</WizardProvider>
	);
}
