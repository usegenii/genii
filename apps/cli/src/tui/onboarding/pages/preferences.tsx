/**
 * Preferences page for the onboarding wizard.
 * @module tui/onboarding/pages/preferences
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { TextInputField } from '../components/text-input-field';
import { useWizard } from '../context';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';

/**
 * Preferences configuration page.
 */
export function PreferencesPage(): React.ReactElement {
	const theme = useTerminalTheme();
	const { state, dispatch } = useWizard();

	// Handle escape to go back
	useWizardKeyboard({
		enabled: true,
		onBack: () => dispatch({ type: 'PREV_PAGE' }),
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
				onChange={(value) =>
					dispatch({ type: 'SET_PREFERENCES', preferences: { timezone: value || undefined } })
				}
				hint="optional, e.g., America/New_York"
				placeholder="Auto-detect"
				isFocused={true}
			/>
		</Box>
	);
}
