/**
 * Multi-select component for the wizard.
 * @module tui/onboarding/components/multi-select
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';

export interface MultiSelectOption {
	value: string;
	label: string;
	description?: string;
}

export interface MultiSelectProps {
	/** Available options */
	options: MultiSelectOption[];
	/** Currently selected values */
	selected: string[];
	/** Change handler */
	onChange: (selected: string[]) => void;
	/** Whether the component is focused */
	isFocused?: boolean;
	/** Tab handler for switching focus */
	onTab?: () => void;
}

/**
 * Multi-select list with checkboxes.
 */
export function MultiSelect({
	options,
	selected,
	onChange,
	isFocused = true,
	onTab,
}: MultiSelectProps): React.ReactElement {
	const theme = useTerminalTheme();
	const [focusedIndex, setFocusedIndex] = useState(0);

	const toggleItem = (value: string) => {
		if (selected.includes(value)) {
			onChange(selected.filter((v) => v !== value));
		} else {
			onChange([...selected, value]);
		}
	};

	useWizardKeyboard({
		enabled: isFocused,
		onUp: () => {
			setFocusedIndex((prev) => Math.max(0, prev - 1));
		},
		onDown: () => {
			setFocusedIndex((prev) => Math.min(options.length - 1, prev + 1));
		},
		onToggle: () => {
			const option = options[focusedIndex];
			if (option) {
				toggleItem(option.value);
			}
		},
		onTab,
	});

	return (
		<Box flexDirection="column">
			{options.map((option, index) => {
				const isSelected = selected.includes(option.value);
				const isFocusedItem = index === focusedIndex && isFocused;

				return (
					<Box key={option.value} flexDirection="column">
						<Box>
							<Text color={isFocusedItem ? theme.primary : theme.muted}>
								{isFocusedItem ? '> ' : '  '}
							</Text>
							<Text color={isSelected ? theme.success : theme.muted}>{isSelected ? '[✓] ' : '[ ] '}</Text>
							<Text color={isFocusedItem ? theme.label : theme.muted} bold={isFocusedItem}>
								{option.label}
							</Text>
						</Box>
						{option.description && isFocusedItem && (
							<Box marginLeft={6}>
								<Text color={theme.hint}>{option.description}</Text>
							</Box>
						)}
					</Box>
				);
			})}
			<Box marginTop={1}>
				<Text color={theme.hint}>Space to toggle, Enter to continue</Text>
			</Box>
		</Box>
	);
}
