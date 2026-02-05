/**
 * Channel type selector component for the onboarding wizard.
 * @module tui/onboarding/components/channel-type-selector
 */

import type { ChannelDefinition } from '@genii/config/channels/definitions';
import { Box, Text } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';

export interface ChannelTypeSelectorProps {
	/** Available channel definitions */
	definitions: ChannelDefinition[];
	/** Called when a channel type is selected */
	onSelect: (definition: ChannelDefinition) => void;
	/** Whether the component is focused */
	isFocused?: boolean;
}

/**
 * Simple list selector for choosing a channel type.
 * Navigate with Up/Down arrows, confirm with Enter.
 */
export function ChannelTypeSelector({
	definitions,
	onSelect,
	isFocused = true,
}: ChannelTypeSelectorProps): React.ReactElement {
	const theme = useTerminalTheme();
	const [selectedIndex, setSelectedIndex] = useState(0);

	useWizardKeyboard({
		enabled: isFocused,
		onUp: () => {
			setSelectedIndex((prev) => Math.max(0, prev - 1));
		},
		onDown: () => {
			setSelectedIndex((prev) => Math.min(definitions.length - 1, prev + 1));
		},
		onNext: () => {
			const selected = definitions[selectedIndex];
			if (selected) {
				onSelect(selected);
			}
		},
	});

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text color={theme.hint}>Select a channel type to add:</Text>
			</Box>
			{definitions.map((def, index) => {
				const isSelected = index === selectedIndex;
				return (
					<Box key={def.id} marginLeft={1}>
						<Text color={isSelected ? theme.primary : theme.muted}>{isSelected ? '❯ ' : '  '}</Text>
						<Text color={isSelected ? theme.label : theme.muted} bold={isSelected}>
							{def.name}
						</Text>
						<Text color={theme.hint}> - {def.description}</Text>
					</Box>
				);
			})}
			<Box marginTop={1}>
				<Text color={theme.hint}>↑↓ navigate · Enter select · Esc back</Text>
			</Box>
		</Box>
	);
}
