/**
 * Main onboarding wizard orchestrator.
 * @module tui/onboarding/wizard
 */

import { Box, Text, useApp } from 'ink';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { completeOnboarding } from './complete';
import { WizardNav } from './components/wizard-nav';
import { loadExistingConfig } from './existing-config-loader';
import { useTerminalTheme } from './hooks/use-terminal-theme';
import { DisclaimerPage } from './pages/disclaimer';
import { ModelSelectionPage } from './pages/model-selection';
import { PreferencesPage } from './pages/preferences';
import { ProviderSetupPage } from './pages/provider-setup';
import { PulsePage } from './pages/pulse';
import { TemplatesPage } from './pages/templates';
import { DEFAULT_STATE, type ExistingConfig, type OnboardingState, PAGES, type WizardPageProps } from './types';

export interface OnboardingWizardProps {
	/** Base path for config files */
	configPath: string;
	/** Callback when setup is complete */
	onComplete?: () => void;
	/** Callback when setup is cancelled */
	onCancel?: () => void;
}

interface WizardContentProps extends OnboardingWizardProps {
	initialState: OnboardingState;
}

/**
 * Inner wizard content with prop-driven state management.
 */
function WizardContent({
	configPath,
	onComplete,
	onCancel: _onCancel,
	initialState,
}: WizardContentProps): React.ReactElement {
	const { exit } = useApp();
	const theme = useTerminalTheme();
	const [state, setState] = useState<OnboardingState>(initialState);
	const [canProceed, setCanProceed] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const isLastPage = state.currentPage === PAGES.length - 1;
	const canGoBack = state.currentPage > 0;

	// Note: Each page is responsible for calling onValidityChange on mount.
	// We don't reset canProceed here because parent effects run after child effects,
	// which would overwrite the page's validity setting.

	const handleCommit = useCallback((updates: Partial<OnboardingState>) => {
		setState((prev) => ({ ...prev, ...updates }));
	}, []);

	const handleValidityChange = useCallback((valid: boolean) => {
		setCanProceed(valid);
	}, []);

	const handleNext = useCallback(() => {
		// Don't advance unless page reports it's valid
		if (!canProceed) return;

		if (isLastPage) {
			// Complete setup - write configs, store secrets, copy templates
			setIsSubmitting(true);
			completeOnboarding(state, configPath)
				.then((result) => {
					if (!result.success) {
						throw new Error(result.error ?? 'Unknown error');
					}
					onComplete?.();
					exit();
				})
				.catch((err) => {
					setError(err instanceof Error ? err.message : String(err));
					setIsSubmitting(false);
				});
		} else {
			setState((prev) => ({ ...prev, currentPage: prev.currentPage + 1 }));
		}
	}, [state, isLastPage, canProceed, configPath, onComplete, exit]);

	const handleBack = useCallback(() => {
		setState((prev) => ({ ...prev, currentPage: Math.max(0, prev.currentPage - 1) }));
	}, []);

	// Note: Pages handle their own Enter key via onNext prop or TextInput onSubmit.
	// The wizard does NOT have a global Enter handler to avoid double-firing.

	const renderPage = () => {
		const pageId = PAGES[state.currentPage]?.id;
		const pageProps: WizardPageProps = {
			state,
			existingConfig: state.existingConfig,
			onCommit: handleCommit,
			onNext: handleNext,
			onBack: handleBack,
			onValidityChange: handleValidityChange,
		};
		switch (pageId) {
			case 'disclaimer':
				return <DisclaimerPage {...pageProps} />;
			case 'provider':
				return <ProviderSetupPage {...pageProps} />;
			case 'models':
				return <ModelSelectionPage {...pageProps} />;
			case 'preferences':
				return <PreferencesPage {...pageProps} />;
			case 'pulse':
				return <PulsePage {...pageProps} />;
			case 'templates':
				return <TemplatesPage {...pageProps} />;
			default:
				return <Text color={theme.error}>Unknown page</Text>;
		}
	};

	return (
		<Box flexDirection="column" padding={1}>
			<WizardNav
				currentPage={state.currentPage}
				canGoBack={canGoBack}
				canProceed={canProceed}
				isComplete={isLastPage}
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
 * Determine the starting page based on existing config.
 * Skip disclaimer if preferences.toml exists (user has completed onboarding before).
 */
function getStartingPage(existingConfig: ExistingConfig | null): number {
	// If preferences.toml exists, skip the disclaimer page
	if (existingConfig?.hasExistingPreferences) {
		return 1; // Start at provider page
	}
	return 0; // Start at disclaimer
}

/**
 * Main onboarding wizard component.
 */
export function OnboardingWizard(props: OnboardingWizardProps): React.ReactElement {
	const [initialState, setInitialState] = useState<OnboardingState | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const theme = useTerminalTheme();

	useEffect(() => {
		async function loadInitialState() {
			// Load existing config from config files
			const configPath = props.configPath.replace(/\/guidance$/, '');
			const existingConfig = await loadExistingConfig(configPath);

			// Determine starting page based on existing config
			const startingPage = getStartingPage(existingConfig);
			setInitialState({
				...DEFAULT_STATE,
				currentPage: startingPage,
				// If skipping disclaimer, mark it as accepted
				disclaimerAccepted: startingPage > 0,
				existingConfig,
			});

			setIsLoading(false);
		}
		loadInitialState();
	}, [props.configPath]);

	if (isLoading) {
		return (
			<Box padding={1}>
				<Text color={theme.muted}>Loading...</Text>
			</Box>
		);
	}

	return <WizardContent {...props} initialState={initialState ?? DEFAULT_STATE} />;
}
