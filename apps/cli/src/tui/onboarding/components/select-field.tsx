/**
 * Select field component for the wizard.
 * @module tui/onboarding/components/select-field
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';

export interface SelectOption {
	value: string;
	label: string;
}

export interface SelectFieldProps {
	/** Field label */
	label: string;
	/** Available options */
	options: SelectOption[];
	/** Currently selected value */
	value: string;
	/** Change handler */
	onChange: (value: string) => void;
	/** Hint text */
	hint?: string;
	/** Whether the field is focused */
	isFocused?: boolean;
	/** Called when up is pressed at the first option */
	onBoundaryUp?: () => void;
	/** Called when down is pressed at the last option */
	onBoundaryDown?: () => void;
}

/**
 * Single-select field with keyboard navigation.
 * Arrow keys highlight options, Space selects the highlighted option.
 */
export function SelectField({
	label,
	options,
	value,
	onChange,
	hint,
	isFocused = true,
	onBoundaryUp,
	onBoundaryDown,
}: SelectFieldProps): React.ReactElement {
	const theme = useTerminalTheme();
	const selectedIndex = options.findIndex((opt) => opt.value === value);
	const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);

	// Sync highlighted index when value changes externally
	useEffect(() => {
		if (selectedIndex >= 0) {
			setHighlightedIndex(selectedIndex);
		}
	}, [selectedIndex]);

	useWizardKeyboard({
		enabled: isFocused,
		onUp: () => {
			if (highlightedIndex > 0) {
				setHighlightedIndex(highlightedIndex - 1);
			} else {
				// At first option, trigger boundary callback
				onBoundaryUp?.();
			}
		},
		onDown: () => {
			if (highlightedIndex < options.length - 1) {
				setHighlightedIndex(highlightedIndex + 1);
			} else {
				// At last option, trigger boundary callback
				onBoundaryDown?.();
			}
		},
		onToggle: () => {
			// Space selects the highlighted option
			const option = options[highlightedIndex];
			if (option) {
				onChange(option.value);
			}
		},
	});

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Text color={theme.label} bold>
					{label}
				</Text>
				{hint && <Text color={theme.hint}> ({hint})</Text>}
			</Box>
			<Box flexDirection="column" marginLeft={2}>
				{options.map((option, index) => {
					const isSelected = option.value === value;
					const isHighlighted = index === highlightedIndex && isFocused;

					return (
						<Box key={option.value}>
							<Text color={isHighlighted ? theme.primary : theme.muted}>
								{isHighlighted ? '> ' : '  '}
							</Text>
							<Text color={isSelected ? theme.success : theme.muted}>{isSelected ? '● ' : '○ '}</Text>
							<Text color={isHighlighted ? theme.label : theme.muted} bold={isHighlighted}>
								{option.label}
							</Text>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
