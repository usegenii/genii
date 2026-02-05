/**
 * Preferences page for the onboarding wizard.
 * @module tui/onboarding/pages/preferences
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect } from 'react';
import { TextInputField } from '../components/text-input-field';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';
import type { WizardPageProps } from '../types';

/**
 * Preferences configuration page.
 */
export function PreferencesPage({
	state,
	onCommit,
	onNext,
	onBack,
	onValidityChange,
}: WizardPageProps): React.ReactElement {
	const theme = useTerminalTheme();

	// Always valid
	useEffect(() => {
		onValidityChange(true);
	}, [onValidityChange]);

	// Handle escape to go back
	useWizardKeyboard({
		enabled: true,
		onBack: () => onBack(),
	});

	return (
		<Box flexDirection="column" paddingX={2}>
			<Box marginBottom={1}>
				<Text color={theme.primary} bold>
					General Preferences
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color={theme.hint}>Configure general settings for Genii.</Text>
			</Box>

			<TextInputField
				label="Timezone"
				value={state.preferences.timezone ?? ''}
				onChange={(value) => onCommit({ preferences: { ...state.preferences, timezone: value || undefined } })}
				hint="optional, e.g., America/New_York"
				placeholder="Auto-detect"
				isFocused={true}
				onSubmit={onNext}
			/>
		</Box>
	);
}
