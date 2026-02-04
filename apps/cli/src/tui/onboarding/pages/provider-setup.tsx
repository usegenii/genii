/**
 * Provider setup page for the onboarding wizard.
 * @module tui/onboarding/pages/provider-setup
 */

import type { AuthMethod, ProviderDefinition } from '@genii/config/providers/definitions';
import { Box, Text } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { ProviderForm } from '../components/provider-form';
import { ProviderSelector } from '../components/provider-selector';
import { useWizard } from '../context';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';
import type { ProviderState } from '../types';

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
 * Provider setup page.
 */
export function ProviderSetupPage(): React.ReactElement {
	const theme = useTerminalTheme();
	const { state, dispatch } = useWizard();

	const [step, setStep] = useState<SetupStep>('select');
	const [provider, setProvider] = useState<ProviderDefinition | null>(null);
	const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
	const [values, setValues] = useState<Record<string, string>>({
		apiType: state.provider.custom?.apiType ?? 'anthropic',
		baseUrl: state.provider.custom?.baseUrl ?? '',
		apiKey: state.provider.apiKey ?? state.provider.custom?.apiKey ?? '',
	});
	const [focusedIndex, setFocusedIndex] = useState(0);

	const handleProviderSelect = (selectedProvider: ProviderDefinition, selectedAuthMethod: AuthMethod) => {
		setProvider(selectedProvider);
		setAuthMethod(selectedAuthMethod);
		setFocusedIndex(0);

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
			dispatch({
				type: 'SET_PROVIDER',
				provider: buildProviderState(provider, newValues),
			});
		}
	};

	const handleCommonFieldsSubmit = () => {
		setFocusedIndex(0);
		setStep('authFields');
	};

	// Handle escape navigation for each step
	useWizardKeyboard({
		enabled: step === 'select',
		onBack: () => dispatch({ type: 'PREV_PAGE' }),
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

	useWizardKeyboard({
		enabled: step === 'authFields',
		onBack: () => {
			if (provider?.commonFields && provider.commonFields.length > 0) {
				setStep('commonFields');
			} else {
				setStep('select');
				setProvider(null);
				setAuthMethod(null);
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

			{step === 'select' && <ProviderSelector onSelect={handleProviderSelect} isFocused={true} />}

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
					</Box>
					<ProviderForm
						fields={authMethod.fields}
						values={values}
						onChange={handleValuesChange}
						focusedIndex={focusedIndex}
						onFocusChange={setFocusedIndex}
					/>
					<Box marginTop={1}>
						<Text color={theme.muted}>Press Esc to go back</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}
