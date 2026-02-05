/**
 * Model selection page for the onboarding wizard.
 * @module tui/onboarding/pages/model-selection
 */

import { getModelsForProvider } from '@genii/config/providers/definitions';
import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { MultiSelect, type MultiSelectOption } from '../components/multi-select';
import { TextInputField } from '../components/text-input-field';
import { getExistingModelsForProvider } from '../existing-config-loader';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';
import type { WizardPageProps } from '../types';

/**
 * Model selection page.
 * Supports both built-in model selection and custom model entry.
 */
export function ModelSelectionPage({
	state,
	onCommit,
	onNext,
	onBack,
	onValidityChange,
}: WizardPageProps): React.ReactElement {
	const theme = useTerminalTheme();
	const [customModelInput, setCustomModelInput] = useState('');
	const [focusMode, setFocusMode] = useState<'list' | 'input'>('list');
	const [hasInitialized, setHasInitialized] = useState(false);

	const isCustomProvider = state.provider.type === 'custom';

	// Get provider ID - use existingProviderId if editing, otherwise builtinId
	const providerId = state.provider.existingProviderId ?? state.provider.builtinId ?? 'zai';
	const availableModels = isCustomProvider ? [] : getModelsForProvider(providerId);

	// Get existing models for the current provider
	const existingModels = getExistingModelsForProvider(state.existingConfig, providerId);
	const existingModelIds = new Set(existingModels.map((m) => m.modelId));

	// Check which selected models are built-in vs custom
	const builtinModelIds = new Set(availableModels.map((m) => m.id));
	const customModels = state.selectedModels.filter((id) => !builtinModelIds.has(id) && !existingModelIds.has(id));

	// Pre-select existing models on first render
	useEffect(() => {
		if (!hasInitialized && existingModels.length > 0) {
			const existingIds = existingModels.map((m) => m.modelId);
			// Merge with any already selected models
			const merged = [...new Set([...state.selectedModels, ...existingIds])];
			if (merged.length !== state.selectedModels.length) {
				onCommit({ selectedModels: merged });
			}
			setHasInitialized(true);
		}
	}, [existingModels, hasInitialized, state.selectedModels, onCommit]);

	// Track models that will be removed (existing models that are deselected)
	const modelsToRemove = existingModels
		.filter((m) => !state.selectedModels.includes(m.modelId))
		.map((m) => m.modelId);

	// Update modelsToRemove in state when it changes
	useEffect(() => {
		const currentRemove = state.modelsToRemove ?? [];
		const removeSet = new Set(modelsToRemove);
		const currentSet = new Set(currentRemove);

		// Check if they're different
		if (
			modelsToRemove.length !== currentRemove.length ||
			modelsToRemove.some((m) => !currentSet.has(m)) ||
			currentRemove.some((m) => !removeSet.has(m))
		) {
			onCommit({ modelsToRemove: modelsToRemove });
		}
	}, [modelsToRemove, state.modelsToRemove, onCommit]);

	// Update validity when selection changes
	useEffect(() => {
		onValidityChange(state.selectedModels.length > 0);
	}, [state.selectedModels.length, onValidityChange]);

	const options: MultiSelectOption[] = availableModels.map((model) => {
		const isExisting = existingModelIds.has(model.id);
		return {
			value: model.id,
			label: isExisting ? `${model.name} [existing]` : model.name,
			description: model.contextWindow
				? `Context: ${(model.contextWindow / 1000).toFixed(0)}k tokens`
				: undefined,
		};
	});

	const handleChange = (selected: string[]) => {
		// Preserve custom models when changing built-in selection
		// Also preserve existing models that are still selected
		const existingStillSelected = existingModels
			.filter((m) => selected.includes(m.modelId) || customModels.includes(m.modelId))
			.map((m) => m.modelId);
		const newSelection = [...new Set([...selected, ...customModels, ...existingStillSelected])];
		onCommit({ selectedModels: newSelection });
	};

	const handleAddCustomModel = () => {
		const trimmed = customModelInput.trim();
		if (trimmed && !state.selectedModels.includes(trimmed)) {
			onCommit({ selectedModels: [...state.selectedModels, trimmed] });
			setCustomModelInput('');
		}
	};

	// Handle escape to go back to provider page
	useWizardKeyboard({
		enabled: true,
		onBack: () => {
			onBack();
		},
	});

	// Handle Enter to advance when in list mode or input mode with empty input
	// (TextInputField's onSubmit handles adding custom models when input has text)
	useWizardKeyboard({
		enabled: focusMode === 'list' || (focusMode === 'input' && customModelInput.trim().length === 0),
		onNext: () => {
			if (state.selectedModels.length > 0) {
				onNext();
			}
		},
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

			{/* Legend for existing models */}
			{existingModels.length > 0 && (
				<Box marginTop={1} flexDirection="column">
					<Text color={theme.muted}>Legend: [existing] = already configured</Text>
				</Box>
			)}

			{/* Warning for models that will be removed */}
			{modelsToRemove.length > 0 && (
				<Box marginTop={1} flexDirection="column">
					<Text color={theme.warning ?? theme.error} bold>
						The following models will be removed:
					</Text>
					{modelsToRemove.map((modelId) => (
						<Box key={modelId} marginLeft={2}>
							<Text color={theme.warning ?? theme.error}>- {modelId}</Text>
						</Box>
					))}
				</Box>
			)}
		</Box>
	);
}
