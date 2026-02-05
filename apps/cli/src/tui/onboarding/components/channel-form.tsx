/**
 * Channel form component for configuring a channel instance.
 * @module tui/onboarding/components/channel-form
 */

import type { ChannelDefinition } from '@genii/config/channels/definitions';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { ApiKeyField } from './api-key-field';
import { FormField } from './form-field';
import { TextInputField } from './text-input-field';

export interface ChannelFormProps {
	/** Channel definition for this type */
	definition: ChannelDefinition;
	/** Instance name (e.g., "telegram-personal") */
	instanceName: string;
	/** Handler for instance name changes */
	onInstanceNameChange: (name: string) => void;
	/** Credential value (bot token, etc.) */
	credentialValue: string;
	/** Handler for credential changes */
	onCredentialChange: (value: string) => void;
	/** Whether an existing credential is stored */
	hasExistingCredential: boolean;
	/** Whether to keep the existing credential */
	keepExistingCredential: boolean;
	/** Toggle handler for keep existing credential */
	onToggleKeepExistingCredential: () => void;
	/** Values for type-specific fields */
	fieldValues: Record<string, string>;
	/** Handler for field value changes */
	onFieldChange: (fieldId: string, value: string) => void;
	/** Called when the form is submitted */
	onSubmit: () => void;
	/** Whether the form is focused */
	isFocused?: boolean;
	/** Whether we're editing an existing channel */
	isEditing: boolean;
	/** Existing channel names (for uniqueness validation) */
	existingNames: string[];
}

/**
 * Form for configuring a single channel instance.
 * Renders vertically: instance name, credential, then type-specific fields.
 * Tab/Enter advances focus between fields, submit on last field.
 */
export function ChannelForm({
	definition,
	instanceName,
	onInstanceNameChange,
	credentialValue,
	onCredentialChange,
	hasExistingCredential,
	keepExistingCredential,
	onToggleKeepExistingCredential,
	fieldValues,
	onFieldChange,
	onSubmit,
	isFocused = true,
	isEditing,
	existingNames,
}: ChannelFormProps): React.ReactElement {
	const theme = useTerminalTheme();

	// Total fields: instance name + credential + definition fields
	const totalFields = 2 + definition.fields.length;
	const [focusedIndex, setFocusedIndex] = useState(isEditing ? 1 : 0);

	// Validate instance name
	const nameError =
		!isEditing && instanceName && existingNames.includes(instanceName) ? 'Name already in use' : undefined;

	// When editing, field 0 (instance name) is read-only text, not focusable
	const minFocusIndex = isEditing ? 1 : 0;

	const advanceFocus = () => {
		if (focusedIndex < totalFields - 1) {
			setFocusedIndex(focusedIndex + 1);
		} else {
			onSubmit();
		}
	};

	const retreatFocus = () => {
		if (focusedIndex > minFocusIndex) {
			setFocusedIndex(focusedIndex - 1);
		}
	};

	// Field navigation: ↑/↓ arrows, Tab/Shift-Tab, Enter on non-input fields
	useInput(
		(_input, key) => {
			// Forward: Tab or Down arrow
			if ((key.tab && !key.shift) || key.downArrow) {
				advanceFocus();
				return;
			}
			// Backward: Shift-Tab or Up arrow
			if ((key.tab && key.shift) || key.upArrow) {
				retreatFocus();
				return;
			}
			// Enter on ApiKeyField "keep existing" toggle advances focus
			// (ApiKeyField only handles Space/Escape in that mode, not Enter)
			if (key.return && focusedIndex === 1 && hasExistingCredential && keepExistingCredential) {
				advanceFocus();
			}
		},
		{ isActive: isFocused },
	);

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text color={theme.hint}>
					{isEditing ? `Editing channel: ${instanceName}` : `Configure new ${definition.name} channel:`}
				</Text>
			</Box>

			{/* Instance name field */}
			{isEditing ? (
				<Box marginBottom={1}>
					<Text color={theme.label} bold>
						Name:{' '}
					</Text>
					<Text color={theme.muted}>{instanceName}</Text>
				</Box>
			) : (
				<TextInputField
					label="Instance Name"
					value={instanceName}
					onChange={onInstanceNameChange}
					placeholder={`e.g., ${definition.id}-personal`}
					hint="Unique name for this channel instance"
					isFocused={isFocused && focusedIndex === 0}
					error={nameError}
					onSubmit={advanceFocus}
				/>
			)}

			{/* Credential field */}
			{hasExistingCredential ? (
				<ApiKeyField
					value={credentialValue}
					onChange={onCredentialChange}
					hasExistingKey={true}
					keepExisting={keepExistingCredential}
					onToggleKeepExisting={onToggleKeepExistingCredential}
					isFocused={isFocused && focusedIndex === 1}
					onSubmit={advanceFocus}
				/>
			) : (
				<TextInputField
					label={definition.credentialField.label}
					value={credentialValue}
					onChange={onCredentialChange}
					placeholder={definition.credentialField.placeholder}
					hint={definition.credentialField.hint}
					isPassword={true}
					isFocused={isFocused && focusedIndex === 1}
					onSubmit={advanceFocus}
				/>
			)}

			{/* Type-specific fields */}
			{definition.fields.map((field, index) => {
				const fieldIndex = 2 + index;
				const isLastField = fieldIndex === totalFields - 1;

				return (
					<FormField
						key={field.id}
						field={field}
						value={fieldValues[field.id] ?? ''}
						onChange={(value) => onFieldChange(field.id, value)}
						isFocused={isFocused && focusedIndex === fieldIndex}
						onSubmit={() => {
							if (isLastField) {
								onSubmit();
							} else {
								advanceFocus();
							}
						}}
					/>
				);
			})}

			<Box marginTop={1}>
				<Text color={theme.hint}>↑↓/Tab navigate · Enter advance · Esc cancel</Text>
			</Box>
		</Box>
	);
}
