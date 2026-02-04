/**
 * Generic form field component that renders based on field type.
 * @module tui/onboarding/components/form-field
 */

import type { SetupField } from '@genii/config/providers/types';
import type React from 'react';
import { SelectField } from './select-field';
import { TextInputField } from './text-input-field';

export interface FormFieldProps {
	/** Field definition from config */
	field: SetupField;
	/** Current value */
	value: string;
	/** Change handler */
	onChange: (value: string) => void;
	/** Whether the field is focused */
	isFocused?: boolean;
	/** Called when up is pressed at the first option (for select fields) */
	onBoundaryUp?: () => void;
	/** Called when down is pressed at the last option (for select fields) */
	onBoundaryDown?: () => void;
	/** Submit handler (for text fields) */
	onSubmit?: () => void;
}

/**
 * Renders a form field based on its type.
 * Dispatches to TextInputField, SelectField, or password variant.
 */
export function FormField({
	field,
	value,
	onChange,
	isFocused = true,
	onBoundaryUp,
	onBoundaryDown,
	onSubmit,
}: FormFieldProps): React.ReactElement {
	switch (field.type) {
		case 'select':
			return (
				<SelectField
					label={field.label}
					options={field.options ?? []}
					value={value}
					onChange={onChange}
					hint={field.hint}
					isFocused={isFocused}
					onBoundaryUp={onBoundaryUp}
					onBoundaryDown={onBoundaryDown}
				/>
			);

		case 'password':
			return (
				<TextInputField
					label={field.label}
					value={value}
					onChange={onChange}
					placeholder={field.placeholder}
					hint={field.hint}
					isPassword={true}
					isFocused={isFocused}
					onSubmit={onSubmit}
				/>
			);

		default:
			return (
				<TextInputField
					label={field.label}
					value={value}
					onChange={onChange}
					placeholder={field.placeholder}
					hint={field.hint}
					isFocused={isFocused}
					onSubmit={onSubmit}
				/>
			);
	}
}
