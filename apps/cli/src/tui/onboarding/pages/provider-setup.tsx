/**
 * Provider setup page for the onboarding wizard.
 * @module tui/onboarding/pages/provider-setup
 */

import type { AuthMethod, ProviderDefinition } from '@genii/config/providers/definitions';
import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { ApiKeyField } from '../components/api-key-field';
import { ProviderForm } from '../components/provider-form';
import { ProviderSelector } from '../components/provider-selector';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';
import type { ExistingProviderInfo, ProviderState, WizardPageProps } from '../types';

type SetupStep = 'select' | 'commonFields' | 'authFields';

/**
 * Build provider state from form values.
 */
function buildProviderState(provider: ProviderDefinition, values: Record<string, string>): ProviderState {
	if (provider.id === 'custom') {
		return {
			type: 'custom',
			custom: {
				apiType: (values.apiType as 'anthropic' | 'openai') ?? 'anthropic',
				baseUrl: values.baseUrl ?? '',
				apiKey: values.apiKey,
			},
		};
	}
	return {
		type: 'builtin',
		builtinId: provider.id,
		apiKey: values.apiKey,
	};
}

/**
 * Check if provider configuration is valid.
 */
function isProviderValid(state: ProviderState): boolean {
	// If keeping existing API key, we don't need a new one
	if (state.keepExistingApiKey) {
		return state.type === 'builtin' ? Boolean(state.builtinId) : Boolean(state.custom?.baseUrl);
	}
	return state.type === 'builtin'
		? Boolean(state.builtinId && state.apiKey)
		: Boolean(state.custom?.baseUrl && state.custom?.apiKey);
}

/**
 * Provider setup page.
 */
export function ProviderSetupPage({
	state,
	onCommit,
	onNext,
	onBack,
	onValidityChange,
}: WizardPageProps): React.ReactElement {
	const theme = useTerminalTheme();

	const [step, setStep] = useState<SetupStep>('select');
	const [provider, setProvider] = useState<ProviderDefinition | null>(null);
	const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
	const [existingProviderInfo, setExistingProviderInfo] = useState<ExistingProviderInfo | null>(null);
	const [values, setValues] = useState<Record<string, string>>({
		apiType: state.provider.custom?.apiType ?? 'anthropic',
		baseUrl: state.provider.custom?.baseUrl ?? '',
		apiKey: state.provider.apiKey ?? state.provider.custom?.apiKey ?? '',
	});
	const [focusedIndex, setFocusedIndex] = useState(0);

	// Update validity when provider state changes
	useEffect(() => {
		onValidityChange(isProviderValid(state.provider));
	}, [state.provider, onValidityChange]);

	const handleProviderSelect = (
		selectedProvider: ProviderDefinition,
		selectedAuthMethod: AuthMethod,
		existingInfo?: ExistingProviderInfo,
	) => {
		setProvider(selectedProvider);
		setAuthMethod(selectedAuthMethod);
		setExistingProviderInfo(existingInfo ?? null);
		setFocusedIndex(0);

		// Pre-fill values from existing config if available
		const newValues = { ...values };
		if (existingInfo) {
			// Pre-fill base URL from existing config
			if (existingInfo.config.baseUrl) {
				newValues.baseUrl = existingInfo.config.baseUrl;
			}
			// Pre-fill API type from existing config
			if (existingInfo.config.type) {
				newValues.apiType = existingInfo.config.type;
			}
		}
		setValues(newValues);

		// Update wizard state with existing provider info
		const providerState: ProviderState = buildProviderState(selectedProvider, newValues);
		if (existingInfo) {
			providerState.existingProviderId = existingInfo.providerId;
			providerState.keepExistingApiKey = existingInfo.hasStoredApiKey;
		}
		onCommit({ provider: providerState });

		// If provider has common fields, show them first
		if (selectedProvider.commonFields && selectedProvider.commonFields.length > 0) {
			setStep('commonFields');
		} else {
			setStep('authFields');
		}
	};

	const handleValuesChange = (fieldId: string, value: string) => {
		const newValues = { ...values, [fieldId]: value };
		setValues(newValues);

		// Update wizard state
		if (provider) {
			const providerState = buildProviderState(provider, newValues);
			// Preserve existing provider tracking
			if (existingProviderInfo) {
				providerState.existingProviderId = existingProviderInfo.providerId;
				providerState.keepExistingApiKey = state.provider.keepExistingApiKey;
			}
			onCommit({ provider: providerState });
		}
	};

	const handleToggleKeepExistingApiKey = () => {
		onCommit({ provider: { ...state.provider, keepExistingApiKey: !state.provider.keepExistingApiKey } });
	};

	const handleCommonFieldsSubmit = () => {
		setFocusedIndex(0);
		setStep('authFields');
	};

	// Handle escape navigation for each step
	useWizardKeyboard({
		enabled: step === 'select',
		onBack: () => onBack(),
	});

	useWizardKeyboard({
		enabled: step === 'commonFields',
		onBack: () => {
			setStep('select');
			setProvider(null);
			setAuthMethod(null);
		},
		onNext: handleCommonFieldsSubmit,
	});

	// Disable back navigation when ApiKeyField is in editing mode (Escape is handled by ApiKeyField)
	const isEditingApiKey = existingProviderInfo?.hasStoredApiKey && !state.provider.keepExistingApiKey;

	useWizardKeyboard({
		enabled: step === 'authFields' && !isEditingApiKey,
		onBack: () => {
			if (provider?.commonFields && provider.commonFields.length > 0) {
				setStep('commonFields');
			} else {
				setStep('select');
				setProvider(null);
				setAuthMethod(null);
			}
		},
		onNext: () => {
			// Only proceed if provider is valid
			if (isProviderValid(state.provider)) {
				onNext();
			}
		},
	});

	const getProviderLabel = (): string => {
		if (!provider) return '';
		if (provider.id === 'custom') {
			const apiType = values.apiType ?? 'anthropic';
			const baseUrl = values.baseUrl;
			return baseUrl ? `Custom (${apiType}) - ${baseUrl}` : `Custom (${apiType})`;
		}
		return provider.name;
	};

	return (
		<Box flexDirection="column" paddingX={2}>
			<Box marginBottom={1}>
				<Text color={theme.primary} bold>
					Configure AI Provider
				</Text>
			</Box>

			{step === 'select' && (
				<ProviderSelector
					onSelect={handleProviderSelect}
					isFocused={true}
					existingConfig={state.existingConfig}
				/>
			)}

			{step === 'commonFields' && provider?.commonFields && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.label}>
							Provider: <Text color={theme.primary}>{provider.name}</Text>
						</Text>
					</Box>
					<ProviderForm
						fields={provider.commonFields}
						values={values}
						onChange={handleValuesChange}
						focusedIndex={focusedIndex}
						onFocusChange={setFocusedIndex}
						onSubmit={handleCommonFieldsSubmit}
					/>
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
					{/* Use ApiKeyField for API key input when there's an existing key */}
					{authMethod.fields.some((f) => f.id === 'apiKey') && existingProviderInfo?.hasStoredApiKey ? (
						<ApiKeyField
							value={values.apiKey ?? ''}
							onChange={(value) => handleValuesChange('apiKey', value)}
							hasExistingKey={existingProviderInfo.hasStoredApiKey}
							keepExisting={state.provider.keepExistingApiKey ?? false}
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
						<Text color={theme.muted}>Press Esc to go back</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}
