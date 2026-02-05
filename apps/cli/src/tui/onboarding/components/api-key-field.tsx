/**
 * API key field component with support for keeping existing keys.
 * @module tui/onboarding/components/api-key-field
 */

import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type React from 'react';
import { useTerminalTheme } from '../hooks/use-terminal-theme';

export interface ApiKeyFieldProps {
	/** Current input value */
	value: string;
	/** Change handler for new key input */
	onChange: (value: string) => void;
	/** Whether the secret store has an existing key */
	hasExistingKey: boolean;
	/** Whether to keep the existing key */
	keepExisting: boolean;
	/** Toggle handler for keep existing checkbox */
	onToggleKeepExisting: () => void;
	/** Whether the field is focused */
	isFocused?: boolean;
	/** Submit handler */
	onSubmit?: () => void;
}

/**
 * API key field that shows toggle for keeping existing key or entering new one.
 *
 * When an existing key is stored:
 * - Shows a toggle checkbox "[x] Keep existing key" with masked display
 * - Space toggles the checkbox
 * - When unchecked, shows input field for new key
 *
 * When no existing key:
 * - Shows normal password input
 */
export function ApiKeyField({
	value,
	onChange,
	hasExistingKey,
	keepExisting,
	onToggleKeepExisting,
	isFocused = true,
	onSubmit,
}: ApiKeyFieldProps): React.ReactElement {
	const theme = useTerminalTheme();

	// Handle space to toggle checkbox (when keeping existing)
	// Handle escape to toggle back to keeping existing (when editing)
	useInput(
		(input, key) => {
			// Space toggles when keeping existing key
			if (keepExisting && input === ' ' && !key.ctrl && !key.meta) {
				onToggleKeepExisting();
			}
			// Escape toggles back to keeping existing when editing
			if (!keepExisting && key.escape) {
				onToggleKeepExisting();
			}
		},
		{ isActive: isFocused && hasExistingKey },
	);

	// No existing key - show normal password input
	if (!hasExistingKey) {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text color={theme.label} bold>
						API Key
					</Text>
					<Text color={theme.hint}> (Your key will be stored securely)</Text>
				</Box>
				<Box marginLeft={2}>
					<Text color={isFocused ? theme.primary : theme.muted}>{'> '}</Text>
					<TextInput
						value={value}
						onChange={onChange}
						placeholder="Enter your API key"
						mask="*"
						focus={isFocused}
						onSubmit={onSubmit}
					/>
				</Box>
			</Box>
		);
	}

	// Has existing key - show toggle and conditional input
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Text color={theme.label} bold>
					API Key
				</Text>
			</Box>

			{/* Keep existing key toggle */}
			<Box marginLeft={2} marginTop={1}>
				<Text color={isFocused && keepExisting ? theme.primary : theme.muted}>
					[{keepExisting ? 'x' : ' '}]{' '}
				</Text>
				<Text color={theme.label}>Keep existing key </Text>
				<Text color={theme.hint}>{'****'}</Text>
			</Box>

			{keepExisting && (
				<Box marginLeft={4}>
					<Text color={theme.hint}>Press Space to enter a new key</Text>
				</Box>
			)}

			{/* New key input when toggle is off */}
			{!keepExisting && (
				<Box flexDirection="column" marginTop={1}>
					<Box marginLeft={2}>
						<Text color={theme.label}>Enter new API key:</Text>
					</Box>
					<Box marginLeft={4}>
						<Text color={isFocused ? theme.primary : theme.muted}>{'> '}</Text>
						<TextInput
							value={value}
							onChange={onChange}
							placeholder="Enter your API key"
							mask="*"
							focus={isFocused}
							onSubmit={onSubmit}
						/>
					</Box>
					<Box marginLeft={4}>
						<Text color={theme.hint}>Press Esc to keep existing key</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}
