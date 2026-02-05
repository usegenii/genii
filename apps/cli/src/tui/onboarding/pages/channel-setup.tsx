/**
 * Channel setup page for the onboarding wizard.
 * @module tui/onboarding/pages/channel-setup
 */

import { type ChannelDefinition, getAllChannelDefinitions } from '@genii/config/channels/definitions';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { ChannelForm } from '../components/channel-form';
import { ChannelTypeSelector } from '../components/channel-type-selector';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';
import type { ChannelInstanceState, WizardPageProps } from '../types';

type SetupStep = 'list' | 'selectType' | 'form';

/**
 * Convert existing channel configs to ChannelInstanceState objects.
 */
function existingToInstanceStates(
	existingChannels: WizardPageProps['state']['existingConfig'] extends infer T
		? T extends { channels: infer C }
			? C
			: never
		: never,
): ChannelInstanceState[] {
	if (!existingChannels || !Array.isArray(existingChannels)) return [];
	return existingChannels.map((ch) => ({
		name: ch.name,
		type: ch.config.type,
		keepExistingCredential: ch.hasStoredCredential,
		fieldValues: Object.entries(ch.config).reduce(
			(acc, [key, value]) => {
				if (key !== 'type' && key !== 'credential') {
					acc[key] = Array.isArray(value) ? value.join(', ') : String(value);
				}
				return acc;
			},
			{} as Record<string, string>,
		),
		isExisting: true,
	}));
}

/**
 * Channel setup page.
 * Manages a list of channel instances with add/edit/remove functionality.
 */
export function ChannelSetupPage({
	state,
	onCommit,
	onNext,
	onBack,
	onValidityChange,
}: WizardPageProps): React.ReactElement {
	const theme = useTerminalTheme();
	const definitions = getAllChannelDefinitions();

	const [step, setStep] = useState<SetupStep>('list');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [selectedDefinition, setSelectedDefinition] = useState<ChannelDefinition | null>(null);
	const [hasInitialized, setHasInitialized] = useState(false);

	// Form working values
	const [formInstanceName, setFormInstanceName] = useState('');
	const [formCredential, setFormCredential] = useState('');
	const [formKeepExistingCredential, setFormKeepExistingCredential] = useState(false);
	const [formFieldValues, setFormFieldValues] = useState<Record<string, string>>({});

	// Pre-populate from existing config on first render
	useEffect(() => {
		if (!hasInitialized && state.existingConfig?.channels && state.existingConfig.channels.length > 0) {
			const existingStates = existingToInstanceStates(state.existingConfig.channels);
			if (existingStates.length > 0) {
				onCommit({ channels: existingStates });
			}
			setHasInitialized(true);
		}
	}, [hasInitialized, state.existingConfig?.channels, onCommit]);

	// Channels not marked for removal
	const activeChannels = state.channels.filter((ch) => !state.channelsToRemove.includes(ch.name));

	// Update validity
	useEffect(() => {
		onValidityChange(activeChannels.length > 0);
	}, [activeChannels.length, onValidityChange]);

	// All channel names (for uniqueness validation)
	const existingNames = state.channels.map((ch) => ch.name);

	// -- List step handlers --

	// Items in the list: channels + "Add new channel" + "Continue" (if valid)
	const listItems: Array<
		{ type: 'channel'; channel: ChannelInstanceState } | { type: 'add' } | { type: 'continue' }
	> = [
		...state.channels.map((ch) => ({
			type: 'channel' as const,
			channel: ch,
		})),
		{ type: 'add' as const },
		...(activeChannels.length > 0 ? [{ type: 'continue' as const }] : []),
	];

	const handleListSelect = () => {
		const item = listItems[selectedIndex];
		if (!item) return;

		if (item.type === 'continue') {
			if (activeChannels.length > 0) {
				onNext();
			}
			return;
		}

		if (item.type === 'add') {
			setStep('selectType');
		} else if (item.type === 'channel') {
			// Edit existing channel
			const channelIndex = selectedIndex;
			const ch = state.channels[channelIndex];
			if (!ch) return;
			const def = definitions.find((d) => d.id === ch.type);
			if (!def) return;

			setEditingIndex(channelIndex);
			setSelectedDefinition(def);
			setFormInstanceName(ch.name);
			setFormCredential(ch.credential ?? '');
			setFormKeepExistingCredential(ch.keepExistingCredential ?? false);
			setFormFieldValues({ ...ch.fieldValues });
			setStep('form');
		}
	};

	const resetFormForNew = (def: ChannelDefinition) => {
		setEditingIndex(null);
		setFormInstanceName('');
		setFormCredential('');
		setFormKeepExistingCredential(false);
		setFormFieldValues(def.defaults ? { ...def.defaults } : {});
	};

	// Toggle removal on 'd' key
	useInput(
		(input) => {
			if (input === 'd') {
				const item = listItems[selectedIndex];
				if (item?.type === 'channel') {
					const ch = item.channel;
					const isMarkedForRemoval = state.channelsToRemove.includes(ch.name);
					if (isMarkedForRemoval) {
						onCommit({
							channelsToRemove: state.channelsToRemove.filter((n) => n !== ch.name),
						});
					} else {
						onCommit({
							channelsToRemove: [...state.channelsToRemove, ch.name],
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
		onNext: () => {
			// Enter on an item: edit/add
			handleListSelect();
		},
		onBack: () => onBack(),
	});

	// Type selection step keyboard
	useWizardKeyboard({
		enabled: step === 'selectType',
		onBack: () => setStep('list'),
	});

	// Disable form-level Escape when ApiKeyField is in "entering new credential" mode
	// (Escape is handled by ApiKeyField to toggle back to "keep existing")
	const formHasExistingCredential =
		editingIndex !== null && (state.channels[editingIndex]?.keepExistingCredential ?? false);
	const isEditingNewCredential = formHasExistingCredential && !formKeepExistingCredential;

	// Form step: only Escape goes back (NOT Backspace — that's needed for text editing)
	useInput(
		(_input, key) => {
			if (key.escape) {
				setStep('list');
			}
		},
		{ isActive: step === 'form' && !isEditingNewCredential },
	);

	// -- Type selection handler --
	const handleTypeSelect = (def: ChannelDefinition) => {
		setSelectedDefinition(def);
		resetFormForNew(def);
		setStep('form');
	};

	// -- Form submit handler --
	const handleFormSubmit = () => {
		if (!selectedDefinition) return;
		if (!formInstanceName.trim()) return;

		const newChannel: ChannelInstanceState = {
			name: formInstanceName.trim(),
			type: selectedDefinition.id,
			credential: formKeepExistingCredential ? undefined : formCredential,
			keepExistingCredential: formKeepExistingCredential,
			fieldValues: { ...formFieldValues },
			isExisting: editingIndex !== null ? state.channels[editingIndex]?.isExisting : false,
		};

		if (editingIndex !== null) {
			// Update existing channel
			const updated = [...state.channels];
			updated[editingIndex] = newChannel;
			onCommit({ channels: updated });
		} else {
			// Add new channel
			onCommit({ channels: [...state.channels, newChannel] });
		}

		setStep('list');
	};

	// -- Render --

	return (
		<Box flexDirection="column" paddingX={2}>
			<Box marginBottom={1}>
				<Text color={theme.primary} bold>
					Configure Channels
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color={theme.hint}>
					Configure at least one messaging channel for your genii to communicate through.
				</Text>
			</Box>

			{step === 'list' && (
				<Box flexDirection="column">
					{state.channels.length === 0 && (
						<Box marginBottom={1}>
							<Text color={theme.warning}>No channels configured. Add at least one to continue.</Text>
						</Box>
					)}

					{state.channels.map((ch, index) => {
						const isSelected = index === selectedIndex;
						const isMarkedForRemoval = state.channelsToRemove.includes(ch.name);
						const badge = isMarkedForRemoval ? ' [removing]' : ch.isExisting ? ' [configured]' : ' [new]';
						const badgeColor = isMarkedForRemoval
							? theme.error
							: ch.isExisting
								? theme.success
								: theme.primary;

						return (
							<Box key={ch.name} marginLeft={1}>
								<Text color={isSelected ? theme.primary : theme.muted}>{isSelected ? '❯ ' : '  '}</Text>
								<Text
									color={isMarkedForRemoval ? theme.muted : isSelected ? theme.label : theme.muted}
									strikethrough={isMarkedForRemoval}
									bold={isSelected}
								>
									{ch.name}
								</Text>
								<Text color={theme.hint}> ({ch.type})</Text>
								<Text color={badgeColor}>{badge}</Text>
							</Box>
						);
					})}

					{/* Add new channel action */}
					{(() => {
						const addIndex = state.channels.length;
						return (
							<Box marginLeft={1} marginTop={state.channels.length > 0 ? 1 : 0}>
								<Text color={selectedIndex === addIndex ? theme.primary : theme.muted}>
									{selectedIndex === addIndex ? '❯ ' : '  '}
								</Text>
								<Text
									color={selectedIndex === addIndex ? theme.success : theme.muted}
									bold={selectedIndex === addIndex}
								>
									+ Add new channel
								</Text>
							</Box>
						);
					})()}

					{/* Continue action (only when channels are configured) */}
					{activeChannels.length > 0 &&
						(() => {
							const continueIndex = state.channels.length + 1;
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

					{activeChannels.length === 0 && state.channels.length > 0 && (
						<Box marginTop={1}>
							<Text color={theme.error}>
								All channels are marked for removal. At least one channel is required.
							</Text>
						</Box>
					)}
				</Box>
			)}

			{step === 'selectType' && (
				<ChannelTypeSelector definitions={definitions} onSelect={handleTypeSelect} isFocused={true} />
			)}

			{step === 'form' && selectedDefinition && (
				<ChannelForm
					definition={selectedDefinition}
					instanceName={formInstanceName}
					onInstanceNameChange={setFormInstanceName}
					credentialValue={formCredential}
					onCredentialChange={setFormCredential}
					hasExistingCredential={
						editingIndex !== null && (state.channels[editingIndex]?.keepExistingCredential ?? false)
					}
					keepExistingCredential={formKeepExistingCredential}
					onToggleKeepExistingCredential={() => setFormKeepExistingCredential(!formKeepExistingCredential)}
					fieldValues={formFieldValues}
					onFieldChange={(fieldId, value) => setFormFieldValues((prev) => ({ ...prev, [fieldId]: value }))}
					onSubmit={handleFormSubmit}
					isFocused={true}
					isEditing={editingIndex !== null}
					existingNames={
						editingIndex !== null ? existingNames.filter((_, i) => i !== editingIndex) : existingNames
					}
				/>
			)}
		</Box>
	);
}
