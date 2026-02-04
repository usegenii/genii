/**
 * Model selection page for the onboarding wizard.
 * @module tui/onboarding/pages/model-selection
 */

import { getModelsForProvider } from '@geniigotchi/config/providers/definitions';
import { Box, Text } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { MultiSelect, type MultiSelectOption } from '../components/multi-select';
import { TextInputField } from '../components/text-input-field';
import { useWizard } from '../context';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';

/**
 * Model selection page.
 * Supports both built-in model selection and custom model entry.
 */
export function ModelSelectionPage(): React.ReactElement {
	const theme = useTerminalTheme();
	const { state, dispatch } = useWizard();
	const [customModelInput, setCustomModelInput] = useState('');
	const [focusMode, setFocusMode] = useState<'list' | 'input'>('list');

	const isCustomProvider = state.provider.type === 'custom';

	// Get available models for built-in providers
	const providerId = state.provider.builtinId ?? 'zai';
	const availableModels = isCustomProvider ? [] : getModelsForProvider(providerId);

	// Check which selected models are built-in vs custom
	const builtinModelIds = new Set(availableModels.map((m) => m.id));
	const customModels = state.selectedModels.filter((id) => !builtinModelIds.has(id));

	const options: MultiSelectOption[] = availableModels.map((model) => ({
		value: model.id,
		label: model.name,
		description: model.contextWindow ? `Context: ${(model.contextWindow / 1000).toFixed(0)}k tokens` : undefined,
	}));

	const handleChange = (selected: string[]) => {
		// Preserve custom models when changing built-in selection
		const newSelection = [...selected, ...customModels];
		dispatch({ type: 'SET_MODELS', models: newSelection });
	};

	const handleAddCustomModel = () => {
		const trimmed = customModelInput.trim();
		if (trimmed && !state.selectedModels.includes(trimmed)) {
			dispatch({ type: 'SET_MODELS', models: [...state.selectedModels, trimmed] });
			setCustomModelInput('');
		}
	};

	// Handle escape to go back to provider page
	useWizardKeyboard({
		enabled: true,
		onBack: () => {
			dispatch({ type: 'PREV_PAGE' });
		},
	});

	// Handle Enter to add custom model when input is focused
	useWizardKeyboard({
		enabled: focusMode === 'input' && customModelInput.trim().length > 0,
		onNext: handleAddCustomModel,
	});

	// For custom providers without built-in models, always focus input
	const showBuiltinList = availableModels.length > 0;
	const effectiveFocusMode = showBuiltinList ? focusMode : 'input';

	return (
		<Box flexDirection="column" paddingX={2}>
			<Box marginBottom={1}>
				<Text color={theme.primary} bold>
					Select Models
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color={theme.hint}>
					{isCustomProvider
						? 'Enter the model IDs you want to use with your custom provider.'
						: 'Choose from available models or add custom model IDs.'}
				</Text>
			</Box>

			{/* Built-in model selection for providers with preset models */}
			{showBuiltinList && (
				<Box flexDirection="column" marginBottom={1}>
					<Box marginBottom={1}>
						<Text color={theme.label} bold>
							Available Models
						</Text>
						{effectiveFocusMode === 'list' && (
							<Text color={theme.muted}> (Tab to switch to custom input)</Text>
						)}
					</Box>
					<MultiSelect
						options={options}
						selected={state.selectedModels.filter((id) => builtinModelIds.has(id))}
						onChange={handleChange}
						isFocused={effectiveFocusMode === 'list'}
						onTab={() => setFocusMode('input')}
					/>
				</Box>
			)}

			{/* Custom model input - always available */}
			<Box flexDirection="column" marginTop={showBuiltinList ? 1 : 0}>
				<Box marginBottom={1}>
					<Text color={theme.label} bold>
						Add Custom Model
					</Text>
					{showBuiltinList && effectiveFocusMode === 'input' && (
						<Text color={theme.muted}> (Tab to switch to list)</Text>
					)}
				</Box>
				<TextInputField
					label="Model ID"
					value={customModelInput}
					onChange={setCustomModelInput}
					placeholder="e.g., gpt-4-turbo"
					hint="Press Enter to add"
					isFocused={effectiveFocusMode === 'input'}
					onSubmit={handleAddCustomModel}
					onTab={showBuiltinList ? () => setFocusMode('list') : undefined}
				/>

				{/* Show custom models that were added */}
				{customModels.length > 0 && (
					<Box marginTop={1} flexDirection="column">
						<Text color={theme.label}>Custom models added:</Text>
						{customModels.map((modelId) => (
							<Box key={modelId} marginLeft={2}>
								<Text color={theme.success}>✓ </Text>
								<Text color={theme.label}>{modelId}</Text>
							</Box>
						))}
					</Box>
				)}
			</Box>

			{state.selectedModels.length === 0 && (
				<Box marginTop={1}>
					<Text color={theme.error}>Please select at least one model to continue.</Text>
				</Box>
			)}
		</Box>
	);
}
