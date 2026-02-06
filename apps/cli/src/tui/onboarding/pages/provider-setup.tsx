/**
 * Provider & model setup page for the onboarding wizard.
 * List-based UX mirroring channel-setup: add/edit/remove providers, each with their own models.
 * @module tui/onboarding/pages/provider-setup
 */

import type { AuthMethod, ProviderDefinition } from '@genii/config/providers/definitions';
import {
	BUILTIN_PROVIDERS,
	CUSTOM_PROVIDER_DEFINITION,
	getModelsForProvider,
	getProvider,
} from '@genii/config/providers/definitions';
import type { SetupField } from '@genii/config/providers/types';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { ApiKeyField } from '../components/api-key-field';
import { MultiSelect, type MultiSelectOption } from '../components/multi-select';
import { ProviderForm } from '../components/provider-form';
import { ProviderSelector } from '../components/provider-selector';
import { TextInputField } from '../components/text-input-field';
import { getExistingModelsForProvider } from '../existing-config-loader';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';
import type { ExistingProviderInfo, ProviderInstanceState, WizardPageProps } from '../types';

type SetupStep = 'list' | 'selectProvider' | 'commonFields' | 'authFields' | 'models';

/** Slug field prepended to commonFields for new custom providers. */
const SLUG_FIELD: SetupField = {
	id: 'slug',
	type: 'text',
	label: 'Provider Name',
	placeholder: 'e.g., my-openai-proxy',
	hint: 'A unique identifier for this provider (lowercase letters, numbers, hyphens)',
	required: true,
};

/** Reserved provider IDs that cannot be used as custom provider slugs. */
const RESERVED_IDS = new Set(['custom', ...BUILTIN_PROVIDERS.map((p) => p.id)]);

/**
 * Validate a custom provider slug.
 * Returns an error message or null if valid.
 */
function validateSlug(slug: string, existingProviderIds: string[], editingId?: string): string | null {
	if (!slug) return 'Provider name is required';
	if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
		return 'Must start with a letter and contain only lowercase letters, numbers, and hyphens';
	}
	if (RESERVED_IDS.has(slug)) {
		return `"${slug}" is a reserved provider name`;
	}
	if (slug !== editingId && existingProviderIds.includes(slug)) {
		return `A provider named "${slug}" already exists`;
	}
	return null;
}

/**
 * Convert existing provider configs to ProviderInstanceState objects.
 */
function existingToInstanceStates(existingConfig: WizardPageProps['state']['existingConfig']): ProviderInstanceState[] {
	if (!existingConfig?.providers || existingConfig.providers.length === 0) return [];

	return existingConfig.providers.map((ep) => {
		const isCustom = !ep.isBuiltin;
		const existingModels = getExistingModelsForProvider(existingConfig, ep.providerId);

		return {
			id: ep.providerId,
			type: isCustom ? 'custom' : 'builtin',
			builtinId: isCustom ? undefined : ep.providerId,
			keepExistingApiKey: ep.hasStoredApiKey,
			existingProviderId: ep.providerId,
			selectedModels: existingModels.map((m) => m.modelId),
			isExisting: true,
			custom: isCustom
				? {
						apiType: (ep.config.type as 'anthropic' | 'openai') ?? 'anthropic',
						baseUrl: ep.config.baseUrl ?? '',
					}
				: undefined,
		};
	});
}

/**
 * Check if a provider instance has valid credentials.
 */
function isProviderValid(inst: ProviderInstanceState): boolean {
	if (inst.keepExistingApiKey) {
		return inst.type === 'builtin' ? Boolean(inst.builtinId) : Boolean(inst.custom?.baseUrl);
	}
	return inst.type === 'builtin'
		? Boolean(inst.builtinId && inst.apiKey)
		: Boolean(inst.custom?.baseUrl && inst.custom?.apiKey);
}

/**
 * Provider & model setup page.
 * Manages a list of provider instances with add/edit/remove, each with inline model selection.
 */
export function ProviderSetupPage({
	state,
	onCommit,
	onNext,
	onBack,
	onValidityChange,
}: WizardPageProps): React.ReactElement {
	const theme = useTerminalTheme();

	const [step, setStep] = useState<SetupStep>('list');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [hasInitialized, setHasInitialized] = useState(false);

	// Working state for the provider being added/edited
	const [workingProvider, setWorkingProvider] = useState<ProviderInstanceState | null>(null);
	const [providerDef, setProviderDef] = useState<ProviderDefinition | null>(null);
	const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
	const [existingProviderInfo, setExistingProviderInfo] = useState<ExistingProviderInfo | null>(null);
	const [values, setValues] = useState<Record<string, string>>({});
	const [focusedIndex, setFocusedIndex] = useState(0);

	// Slug validation state
	const [slugError, setSlugError] = useState<string | null>(null);

	// Model selection working state
	const [customModelInput, setCustomModelInput] = useState('');
	const [modelFocusMode, setModelFocusMode] = useState<'list' | 'input'>('list');

	// Pre-populate from existing config on first render
	useEffect(() => {
		if (!hasInitialized && state.existingConfig?.providers && state.existingConfig.providers.length > 0) {
			const existingStates = existingToInstanceStates(state.existingConfig);
			if (existingStates.length > 0) {
				onCommit({ providers: existingStates });
			}
			setHasInitialized(true);
		}
	}, [hasInitialized, state.existingConfig, onCommit]);

	// Providers not marked for removal
	const activeProviders = state.providers.filter((p) => !state.providersToRemove.includes(p.id));

	// Update validity
	useEffect(() => {
		onValidityChange(activeProviders.length > 0);
	}, [activeProviders.length, onValidityChange]);

	// --- List items ---
	const listItems: Array<
		{ type: 'provider'; provider: ProviderInstanceState } | { type: 'add' } | { type: 'continue' }
	> = [
		...state.providers.map((p) => ({
			type: 'provider' as const,
			provider: p,
		})),
		{ type: 'add' as const },
		...(activeProviders.length > 0 ? [{ type: 'continue' as const }] : []),
	];

	// --- List step handlers ---

	const handleListSelect = () => {
		const item = listItems[selectedIndex];
		if (!item) return;

		if (item.type === 'continue') {
			if (activeProviders.length > 0) {
				onNext();
			}
			return;
		}

		if (item.type === 'add') {
			setStep('selectProvider');
			return;
		}

		if (item.type === 'provider') {
			// Edit existing provider instance
			const providerIndex = selectedIndex;
			const inst = state.providers[providerIndex];
			if (!inst) return;

			const def = inst.type === 'custom' ? CUSTOM_PROVIDER_DEFINITION : getProvider(inst.builtinId ?? inst.id);
			if (!def) return;

			setEditingIndex(providerIndex);
			setWorkingProvider({ ...inst });
			setProviderDef(def);
			setAuthMethod(def.authMethods[0] ?? null);
			setExistingProviderInfo(state.existingConfig?.providers.find((p) => p.providerId === inst.id) ?? null);
			setValues({
				slug: inst.id,
				apiType: inst.custom?.apiType ?? 'anthropic',
				baseUrl: inst.custom?.baseUrl ?? '',
				apiKey: inst.apiKey ?? inst.custom?.apiKey ?? '',
			});
			setFocusedIndex(0);
			setSlugError(null);
			setCustomModelInput('');
			setModelFocusMode('list');

			// Custom providers always show commonFields (slug + apiType + baseUrl)
			if (inst.type === 'custom' || (def.commonFields && def.commonFields.length > 0)) {
				setStep('commonFields');
			} else {
				setStep('authFields');
			}
		}
	};

	// Toggle removal on 'd' key
	useInput(
		(input) => {
			if (input === 'd') {
				const item = listItems[selectedIndex];
				if (item?.type === 'provider') {
					const p = item.provider;
					const isMarkedForRemoval = state.providersToRemove.includes(p.id);
					if (isMarkedForRemoval) {
						onCommit({
							providersToRemove: state.providersToRemove.filter((id) => id !== p.id),
						});
					} else {
						onCommit({
							providersToRemove: [...state.providersToRemove, p.id],
						});
					}
				}
			}
		},
		{ isActive: step === 'list' },
	);

	// List step keyboard
	useWizardKeyboard({
		enabled: step === 'list',
		onUp: () => setSelectedIndex((prev) => Math.max(0, prev - 1)),
		onDown: () => setSelectedIndex((prev) => Math.min(listItems.length - 1, prev + 1)),
		onNext: () => handleListSelect(),
		onBack: () => onBack(),
	});

	// --- Provider selection handler ---
	const handleProviderSelect = (
		selectedProvider: ProviderDefinition,
		selectedAuthMethod: AuthMethod,
		existingInfo?: ExistingProviderInfo,
	) => {
		const isCustom = selectedProvider.id === 'custom';
		const providerId = existingInfo?.providerId ?? selectedProvider.id;

		// Check if this provider type is already configured (skip for new custom — they get unique slugs)
		const existingIdx = isCustom && !existingInfo ? -1 : state.providers.findIndex((p) => p.id === providerId);

		if (existingIdx >= 0) {
			// Enter edit mode for the existing provider
			const inst = state.providers[existingIdx];
			if (!inst) return;
			setEditingIndex(existingIdx);
			setWorkingProvider({ ...inst });
			setValues({
				slug: inst.id,
				apiType: inst.custom?.apiType ?? 'anthropic',
				baseUrl: inst.custom?.baseUrl ?? '',
				apiKey: inst.apiKey ?? inst.custom?.apiKey ?? '',
			});
		} else {
			// Creating new provider
			setEditingIndex(null);
			setWorkingProvider({
				id: providerId,
				type: isCustom ? 'custom' : 'builtin',
				builtinId: isCustom ? undefined : selectedProvider.id,
				selectedModels: [],
				keepExistingApiKey: existingInfo?.hasStoredApiKey,
				existingProviderId: existingInfo?.providerId,
			});
			setValues({
				slug: '',
				apiType: 'anthropic',
				baseUrl: '',
				apiKey: '',
			});
		}

		setProviderDef(selectedProvider);
		setAuthMethod(selectedAuthMethod);
		setExistingProviderInfo(existingInfo ?? null);
		setFocusedIndex(0);
		setSlugError(null);
		setCustomModelInput('');
		setModelFocusMode('list');

		// Pre-fill values from existing config
		if (existingInfo) {
			const newValues: Record<string, string> = {
				slug: existingInfo.providerId,
				apiType: 'anthropic',
				baseUrl: '',
				apiKey: '',
			};
			if (existingInfo.config.baseUrl) {
				newValues.baseUrl = existingInfo.config.baseUrl;
			}
			if (existingInfo.config.type) {
				newValues.apiType = existingInfo.config.type;
			}
			setValues(newValues);
		}

		// Custom providers always have commonFields (slug + apiType + baseUrl)
		if (isCustom || (selectedProvider.commonFields && selectedProvider.commonFields.length > 0)) {
			setStep('commonFields');
		} else {
			setStep('authFields');
		}
	};

	// Select provider step keyboard
	useWizardKeyboard({
		enabled: step === 'selectProvider',
		onBack: () => setStep('list'),
	});

	// --- Common fields handlers ---
	const handleValuesChange = (fieldId: string, value: string) => {
		setValues((prev) => ({ ...prev, [fieldId]: value }));
	};

	const handleCommonFieldsSubmit = () => {
		// Validate slug for custom providers
		if (providerDef?.id === 'custom') {
			const slug = values.slug?.trim() ?? '';
			const existingIds = state.providers.map((p) => p.id);
			const editingId = editingIndex !== null ? state.providers[editingIndex]?.id : undefined;
			const error = validateSlug(slug, existingIds, editingId);
			if (error) {
				setSlugError(error);
				return;
			}
			setSlugError(null);
			// Update working provider id from slug
			if (workingProvider) {
				setWorkingProvider({ ...workingProvider, id: slug });
			}
		}
		setFocusedIndex(0);
		setStep('authFields');
	};

	// Common fields step: only Escape goes back (NOT Backspace — that's needed for text editing).
	// ProviderForm's onSubmit handles Enter on the last field to advance.
	useInput(
		(_input, key) => {
			if (key.escape) {
				if (editingIndex !== null) {
					setStep('list');
				} else {
					setStep('selectProvider');
				}
				setProviderDef(null);
				setAuthMethod(null);
			}
		},
		{ isActive: step === 'commonFields' },
	);

	// --- Auth fields handlers ---
	const handleToggleKeepExistingApiKey = () => {
		if (workingProvider) {
			setWorkingProvider({ ...workingProvider, keepExistingApiKey: !workingProvider.keepExistingApiKey });
		}
	};

	const handleAuthSubmit = () => {
		if (!workingProvider) return;

		// Build updated working provider from current values
		let updated: ProviderInstanceState;
		if (workingProvider.type === 'custom' || providerDef?.id === 'custom') {
			updated = {
				...workingProvider,
				type: 'custom',
				custom: {
					apiType: (values.apiType as 'anthropic' | 'openai') ?? 'anthropic',
					baseUrl: values.baseUrl ?? '',
					apiKey: values.apiKey,
				},
			};
		} else {
			updated = {
				...workingProvider,
				apiKey: values.apiKey,
			};
		}

		// Validate before proceeding
		if (!isProviderValid(updated)) return;

		setWorkingProvider(updated);
		setCustomModelInput('');
		setModelFocusMode('list');
		setStep('models');
	};

	// Disable back navigation when ApiKeyField is in editing mode
	const isEditingApiKey = existingProviderInfo?.hasStoredApiKey && !workingProvider?.keepExistingApiKey;

	useWizardKeyboard({
		enabled: step === 'authFields' && !isEditingApiKey,
		onBack: () => {
			if (providerDef?.commonFields && providerDef.commonFields.length > 0) {
				setStep('commonFields');
			} else if (editingIndex !== null) {
				setStep('list');
			} else {
				setStep('selectProvider');
				setProviderDef(null);
				setAuthMethod(null);
			}
		},
		onNext: handleAuthSubmit,
	});

	// --- Models step ---
	const workingProviderId =
		workingProvider?.existingProviderId ?? workingProvider?.builtinId ?? workingProvider?.id ?? '';
	const isCustomProvider = workingProvider?.type === 'custom';
	const availableModels = isCustomProvider ? [] : getModelsForProvider(workingProviderId);
	const existingModelsForProvider = getExistingModelsForProvider(state.existingConfig, workingProviderId);
	const existingModelIds = new Set(existingModelsForProvider.map((m) => m.modelId));
	const builtinModelIds = new Set(availableModels.map((m) => m.id));
	const workingSelectedModels = workingProvider?.selectedModels ?? [];
	const customModels = workingSelectedModels.filter((id) => !builtinModelIds.has(id) && !existingModelIds.has(id));
	const showBuiltinList = availableModels.length > 0;
	const effectiveModelFocusMode = showBuiltinList ? modelFocusMode : 'input';

	const modelOptions: MultiSelectOption[] = availableModels.map((model) => {
		const isExisting = existingModelIds.has(model.id);
		return {
			value: model.id,
			label: isExisting ? `${model.name} [existing]` : model.name,
			description: model.contextWindow
				? `Context: ${(model.contextWindow / 1000).toFixed(0)}k tokens`
				: undefined,
		};
	});

	const handleModelChange = (selected: string[]) => {
		if (!workingProvider) return;
		const existingStillSelected = existingModelsForProvider
			.filter((m) => selected.includes(m.modelId) || customModels.includes(m.modelId))
			.map((m) => m.modelId);
		const newSelection = [...new Set([...selected, ...customModels, ...existingStillSelected])];
		setWorkingProvider({ ...workingProvider, selectedModels: newSelection });
	};

	const handleAddCustomModel = () => {
		if (!workingProvider) return;
		const trimmed = customModelInput.trim();
		if (trimmed && !workingSelectedModels.includes(trimmed)) {
			setWorkingProvider({
				...workingProvider,
				selectedModels: [...workingSelectedModels, trimmed],
			});
			setCustomModelInput('');
		}
	};

	const handleModelsSubmit = () => {
		if (!workingProvider || workingSelectedModels.length === 0) return;

		// Commit provider instance with its models back to wizard state
		const updated = [...state.providers];
		if (editingIndex !== null) {
			updated[editingIndex] = workingProvider;
		} else {
			updated.push(workingProvider);
		}
		onCommit({ providers: updated });

		// Reset and return to list
		setWorkingProvider(null);
		setProviderDef(null);
		setAuthMethod(null);
		setExistingProviderInfo(null);
		setEditingIndex(null);
		setStep('list');
	};

	useWizardKeyboard({
		enabled:
			step === 'models' &&
			(effectiveModelFocusMode === 'list' ||
				(effectiveModelFocusMode === 'input' && customModelInput.trim().length === 0)),
		onBack: () => setStep('authFields'),
		onNext: () => {
			if (workingSelectedModels.length > 0) {
				handleModelsSubmit();
			}
		},
	});

	// --- Render helpers ---
	const getProviderLabel = (): string => {
		if (!providerDef) return '';
		if (providerDef.id === 'custom') {
			const slug = values.slug || workingProvider?.id || 'custom';
			const apiType = values.apiType ?? 'anthropic';
			const baseUrl = values.baseUrl;
			return baseUrl ? `${slug} (${apiType}) - ${baseUrl}` : `${slug} (${apiType})`;
		}
		return providerDef.name;
	};

	const getProviderDisplayName = (inst: ProviderInstanceState): string => {
		if (inst.type === 'custom') {
			const apiType = inst.custom?.apiType ?? 'anthropic';
			const baseUrl = inst.custom?.baseUrl;
			return baseUrl ? `${inst.id} (${apiType}) - ${baseUrl}` : `${inst.id} (${apiType})`;
		}
		const def = getProvider(inst.builtinId ?? inst.id);
		return def ? `${def.name}` : inst.id;
	};

	// --- Render ---

	return (
		<Box flexDirection="column" paddingX={2}>
			<Box marginBottom={1}>
				<Text color={theme.primary} bold>
					Configure AI Providers
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color={theme.hint}>Configure at least one AI provider with models for your genii to use.</Text>
			</Box>

			{step === 'list' && (
				<Box flexDirection="column">
					{state.providers.length === 0 && (
						<Box marginBottom={1}>
							<Text color={theme.warning}>No providers configured. Add at least one to continue.</Text>
						</Box>
					)}

					{state.providers.map((inst, index) => {
						const isSelected = index === selectedIndex;
						const isMarkedForRemoval = state.providersToRemove.includes(inst.id);
						const modelCount = inst.selectedModels.length;
						const badge = isMarkedForRemoval ? ' [removing]' : inst.isExisting ? ' [configured]' : ' [new]';
						const badgeColor = isMarkedForRemoval
							? theme.error
							: inst.isExisting
								? theme.success
								: theme.primary;

						return (
							<Box key={inst.id} marginLeft={1}>
								<Text color={isSelected ? theme.primary : theme.muted}>{isSelected ? '❯ ' : '  '}</Text>
								<Text
									color={isMarkedForRemoval ? theme.muted : isSelected ? theme.label : theme.muted}
									strikethrough={isMarkedForRemoval}
									bold={isSelected}
								>
									{getProviderDisplayName(inst)}
								</Text>
								<Text color={theme.hint}>
									{' '}
									- {modelCount} model{modelCount !== 1 ? 's' : ''}
								</Text>
								<Text color={badgeColor}>{badge}</Text>
							</Box>
						);
					})}

					{/* Add provider action */}
					{(() => {
						const addIndex = state.providers.length;
						return (
							<Box marginLeft={1} marginTop={state.providers.length > 0 ? 1 : 0}>
								<Text color={selectedIndex === addIndex ? theme.primary : theme.muted}>
									{selectedIndex === addIndex ? '❯ ' : '  '}
								</Text>
								<Text
									color={selectedIndex === addIndex ? theme.success : theme.muted}
									bold={selectedIndex === addIndex}
								>
									+ Add provider
								</Text>
							</Box>
						);
					})()}

					{/* Continue action */}
					{activeProviders.length > 0 &&
						(() => {
							const continueIndex = state.providers.length + 1;
							return (
								<Box marginLeft={1} marginTop={1}>
									<Text color={selectedIndex === continueIndex ? theme.primary : theme.muted}>
										{selectedIndex === continueIndex ? '❯ ' : '  '}
									</Text>
									<Text
										color={selectedIndex === continueIndex ? theme.primary : theme.muted}
										bold={selectedIndex === continueIndex}
									>
										Continue →
									</Text>
								</Box>
							);
						})()}

					<Box marginTop={1}>
						<Text color={theme.hint}>↑↓ navigate · Enter select · d toggle remove · Esc back</Text>
					</Box>

					{activeProviders.length === 0 && state.providers.length > 0 && (
						<Box marginTop={1}>
							<Text color={theme.error}>
								All providers are marked for removal. At least one provider is required.
							</Text>
						</Box>
					)}
				</Box>
			)}

			{step === 'selectProvider' && (
				<ProviderSelector
					onSelect={handleProviderSelect}
					isFocused={true}
					existingConfig={state.existingConfig}
				/>
			)}

			{step === 'commonFields' && providerDef && (providerDef.commonFields || providerDef.id === 'custom') && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.label}>
							Provider: <Text color={theme.primary}>{providerDef.name}</Text>
						</Text>
					</Box>
					<ProviderForm
						fields={
							providerDef.id === 'custom'
								? [SLUG_FIELD, ...(providerDef.commonFields ?? [])]
								: (providerDef.commonFields ?? [])
						}
						values={values}
						onChange={(fieldId, value) => {
							handleValuesChange(fieldId, value);
							if (fieldId === 'slug') setSlugError(null);
						}}
						focusedIndex={focusedIndex}
						onFocusChange={setFocusedIndex}
						onSubmit={handleCommonFieldsSubmit}
					/>
					{slugError && (
						<Box marginTop={1}>
							<Text color={theme.error}>{slugError}</Text>
						</Box>
					)}
					<Box marginTop={1}>
						<Text color={theme.muted}>Press Enter to continue, Esc to go back</Text>
					</Box>
				</Box>
			)}

			{step === 'authFields' && authMethod && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.label}>
							Provider: <Text color={theme.primary}>{getProviderLabel()}</Text>
						</Text>
						{existingProviderInfo && <Text color={theme.hint}> (editing existing configuration)</Text>}
					</Box>
					{authMethod.fields.some((f) => f.id === 'apiKey') && existingProviderInfo?.hasStoredApiKey ? (
						<ApiKeyField
							value={values.apiKey ?? ''}
							onChange={(value) => handleValuesChange('apiKey', value)}
							hasExistingKey={existingProviderInfo.hasStoredApiKey}
							keepExisting={workingProvider?.keepExistingApiKey ?? false}
							onToggleKeepExisting={handleToggleKeepExistingApiKey}
							isFocused={true}
						/>
					) : (
						<ProviderForm
							fields={authMethod.fields}
							values={values}
							onChange={handleValuesChange}
							focusedIndex={focusedIndex}
							onFocusChange={setFocusedIndex}
						/>
					)}
					<Box marginTop={1}>
						<Text color={theme.muted}>Press Enter to continue to models, Esc to go back</Text>
					</Box>
				</Box>
			)}

			{step === 'models' && workingProvider && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.primary} bold>
							Select Models for {getProviderLabel()}
						</Text>
					</Box>

					<Box marginBottom={1}>
						<Text color={theme.hint}>
							{isCustomProvider
								? 'Enter the model IDs you want to use with your custom provider.'
								: 'Choose from available models or add custom model IDs.'}
						</Text>
					</Box>

					{showBuiltinList && (
						<Box flexDirection="column" marginBottom={1}>
							<Box marginBottom={1}>
								<Text color={theme.label} bold>
									Available Models
								</Text>
								{effectiveModelFocusMode === 'list' && (
									<Text color={theme.muted}> (Tab to switch to custom input)</Text>
								)}
							</Box>
							<MultiSelect
								options={modelOptions}
								selected={workingSelectedModels.filter((id) => builtinModelIds.has(id))}
								onChange={handleModelChange}
								isFocused={effectiveModelFocusMode === 'list'}
								onTab={() => setModelFocusMode('input')}
							/>
						</Box>
					)}

					<Box flexDirection="column" marginTop={showBuiltinList ? 1 : 0}>
						<Box marginBottom={1}>
							<Text color={theme.label} bold>
								Add Custom Model
							</Text>
							{showBuiltinList && effectiveModelFocusMode === 'input' && (
								<Text color={theme.muted}> (Tab to switch to list)</Text>
							)}
						</Box>
						<TextInputField
							label="Model ID"
							value={customModelInput}
							onChange={setCustomModelInput}
							placeholder="e.g., gpt-4-turbo"
							hint="Press Enter to add"
							isFocused={effectiveModelFocusMode === 'input'}
							onSubmit={handleAddCustomModel}
							onTab={showBuiltinList ? () => setModelFocusMode('list') : undefined}
						/>

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

					{workingSelectedModels.length === 0 && (
						<Box marginTop={1}>
							<Text color={theme.error}>Please select at least one model to continue.</Text>
						</Box>
					)}

					{existingModelsForProvider.length > 0 && (
						<Box marginTop={1}>
							<Text color={theme.muted}>Legend: [existing] = already configured</Text>
						</Box>
					)}

					<Box marginTop={1}>
						<Text color={theme.muted}>Press Enter to save provider, Esc to go back</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}
