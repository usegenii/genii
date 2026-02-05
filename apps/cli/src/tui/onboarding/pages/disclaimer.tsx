/**
 * Disclaimer page for the onboarding wizard.
 * @module tui/onboarding/pages/disclaimer
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect } from 'react';
import { ToggleField } from '../components/toggle-field';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';
import type { WizardPageProps } from '../types';

const DISCLAIMER_TEXT = `Before proceeding, please read and accept the following:

1. AUTONOMOUS ACTIONS: Genii can perform autonomous actions on your system,
   including executing shell commands, modifying files, and making API calls.

2. DATA HANDLING: Your prompts and data may be sent to external AI providers.
   Review your provider's privacy policy for details.

3. MONITORING: You are responsible for monitoring Genii's behavior during
   operation and ensuring it acts within your intended scope.

4. TESTING: We recommend testing in a sandboxed environment first.`;

/**
 * Disclaimer acceptance page.
 */
export function DisclaimerPage({ state, onCommit, onNext, onValidityChange }: WizardPageProps): React.ReactElement {
	const theme = useTerminalTheme();

	// Update validity when disclaimer acceptance changes
	useEffect(() => {
		onValidityChange(state.disclaimerAccepted);
	}, [state.disclaimerAccepted, onValidityChange]);

	// Handle Enter to advance when accepted
	useWizardKeyboard({
		enabled: state.disclaimerAccepted,
		onNext,
	});

	return (
		<Box flexDirection="column" paddingX={2}>
			<Box marginBottom={1}>
				<Text color={theme.warning} bold>
					⚠️ Important Safety Information
				</Text>
			</Box>

			<Box marginBottom={2} flexDirection="column">
				<Text color={theme.label}>{DISCLAIMER_TEXT}</Text>
			</Box>

			<Box marginTop={1}>
				<ToggleField
					label="I have read and accept the above terms"
					value={state.disclaimerAccepted}
					onChange={() => onCommit({ disclaimerAccepted: !state.disclaimerAccepted })}
					isFocused={true}
				/>
			</Box>

			{!state.disclaimerAccepted && (
				<Box marginTop={1}>
					<Text color={theme.hint}>Press Space or Enter to accept and continue</Text>
				</Box>
			)}
		</Box>
	);
}
