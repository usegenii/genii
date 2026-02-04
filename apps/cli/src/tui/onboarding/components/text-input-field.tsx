/**
 * Text input field component for the wizard.
 * @module tui/onboarding/components/text-input-field
 */

import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type React from 'react';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';

export interface TextInputFieldProps {
	/** Field label */
	label: string;
	/** Current value */
	value: string;
	/** Change handler */
	onChange: (value: string) => void;
	/** Placeholder text */
	placeholder?: string;
	/** Whether to mask input (for passwords) */
	isPassword?: boolean;
	/** Error message to display */
	error?: string;
	/** Hint text */
	hint?: string;
	/** Whether the field is focused */
	isFocused?: boolean;
	/** Submit handler */
	onSubmit?: () => void;
	/** Tab handler for switching focus */
	onTab?: () => void;
}

/**
 * Text input field with label, hint, and error display.
 */
export function TextInputField({
	label,
	value,
	onChange,
	placeholder = '',
	isPassword = false,
	error,
	hint,
	isFocused = true,
	onSubmit,
	onTab,
}: TextInputFieldProps): React.ReactElement {
	const theme = useTerminalTheme();

	// Handle Tab key for focus navigation
	useWizardKeyboard({
		enabled: isFocused && onTab !== undefined,
		onTab,
	});

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Text color={theme.label} bold>
					{label}
				</Text>
				{hint && <Text color={theme.hint}> ({hint})</Text>}
			</Box>
			<Box marginLeft={2}>
				<Text color={isFocused ? theme.primary : theme.muted}>{'> '}</Text>
				<TextInput
					value={value}
					onChange={onChange}
					placeholder={placeholder}
					mask={isPassword ? '*' : undefined}
					focus={isFocused}
					onSubmit={onSubmit}
				/>
			</Box>
			{error && (
				<Box marginLeft={2}>
					<Text color={theme.error}>{error}</Text>
				</Box>
			)}
		</Box>
	);
}
