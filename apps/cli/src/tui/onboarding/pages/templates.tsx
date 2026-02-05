/**
 * Templates page for the onboarding wizard.
 * @module tui/onboarding/pages/templates
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect } from 'react';
import { SelectField, type SelectOption } from '../components/select-field';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';
import type { TemplatesState, WizardPageProps } from '../types';

const TEMPLATE_FILES = ['INSTRUCTIONS.md', 'SOUL.md', 'PULSE.md'];

const OVERWRITE_OPTIONS: SelectOption[] = [
	{ value: 'backup', label: 'Backup existing files (.bak)' },
	{ value: 'skip', label: 'Skip existing files' },
	{ value: 'overwrite', label: 'Overwrite existing files' },
];

/**
 * Templates installation page.
 */
export function TemplatesPage({
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

	// Handle keyboard navigation
	useWizardKeyboard({
		enabled: true,
		onNext,
		onBack: () => onBack(),
	});

	return (
		<Box flexDirection="column" paddingX={2}>
			<Box marginBottom={1}>
				<Text color={theme.primary} bold>
					Install Template Files
				</Text>
			</Box>

			<Box marginBottom={1} flexDirection="column">
				<Text color={theme.hint}>Template files provide guidance for how Genii should behave.</Text>
				<Text color={theme.hint}>These will be copied to your guidance directory.</Text>
			</Box>

			<Box marginBottom={2} flexDirection="column">
				<Text color={theme.label} bold>
					Files to install:
				</Text>
				{TEMPLATE_FILES.map((file) => (
					<Box key={file} marginLeft={2}>
						<Text color={theme.muted}>• </Text>
						<Text color={theme.label}>{file}</Text>
					</Box>
				))}
			</Box>

			<SelectField
				label="If files already exist"
				options={OVERWRITE_OPTIONS}
				value={state.templates.overwriteMode}
				onChange={(value) =>
					onCommit({ templates: { overwriteMode: value as TemplatesState['overwriteMode'] } })
				}
				isFocused={true}
			/>

			<Box marginTop={2} flexDirection="column">
				<Text color={theme.success} bold>
					Ready to complete setup!
				</Text>
				<Text color={theme.hint}>Press Enter to save configuration and install templates.</Text>
			</Box>
		</Box>
	);
}
