/**
 * Toggle field component for the wizard.
 * @module tui/onboarding/components/toggle-field
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';

export interface ToggleFieldProps {
	/** Field label */
	label: string;
	/** Current value */
	value: boolean;
	/** Change handler */
	onChange: (value: boolean) => void;
	/** Description text */
	description?: string;
	/** Whether the field is focused */
	isFocused?: boolean;
}

/**
 * Boolean toggle field.
 */
export function ToggleField({
	label,
	value,
	onChange,
	description,
	isFocused = true,
}: ToggleFieldProps): React.ReactElement {
	const theme = useTerminalTheme();

	useWizardKeyboard({
		enabled: isFocused,
		onToggle: () => onChange(!value),
		onNext: () => onChange(!value),
	});

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Text color={isFocused ? theme.primary : theme.muted}>{value ? '[✓] ' : '[ ] '}</Text>
				<Text color={theme.label} bold>
					{label}
				</Text>
			</Box>
			{description && (
				<Box marginLeft={4}>
					<Text color={theme.hint}>{description}</Text>
				</Box>
			)}
		</Box>
	);
}
