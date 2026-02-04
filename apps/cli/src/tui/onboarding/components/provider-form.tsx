/**
 * Provider form component that renders fields from config.
 * @module tui/onboarding/components/provider-form
 */

import type { SetupField } from '@geniigotchi/config/providers/types';
import { Box } from 'ink';
import type React from 'react';
import { FormField } from './form-field';

export interface ProviderFormProps {
	/** Fields to render */
	fields: SetupField[];
	/** Current values for each field (keyed by field id) */
	values: Record<string, string>;
	/** Change handler */
	onChange: (fieldId: string, value: string) => void;
	/** Currently focused field index */
	focusedIndex: number;
	/** Focus change handler */
	onFocusChange: (index: number) => void;
	/** Called when the last field is submitted */
	onSubmit?: () => void;
}

/**
 * Renders a form with fields from provider config.
 * Handles focus management and navigation between fields.
 */
export function ProviderForm({
	fields,
	values,
	onChange,
	focusedIndex,
	onFocusChange,
	onSubmit,
}: ProviderFormProps): React.ReactElement {
	return (
		<Box flexDirection="column">
			{fields.map((field, index) => {
				const isFocused = index === focusedIndex;
				const isLastField = index === fields.length - 1;

				return (
					<FormField
						key={field.id}
						field={field}
						value={values[field.id] ?? ''}
						onChange={(value) => onChange(field.id, value)}
						isFocused={isFocused}
						onBoundaryUp={() => {
							if (index > 0) {
								onFocusChange(index - 1);
							}
						}}
						onBoundaryDown={() => {
							if (index < fields.length - 1) {
								onFocusChange(index + 1);
							}
						}}
						onSubmit={() => {
							if (isLastField) {
								onSubmit?.();
							} else {
								onFocusChange(index + 1);
							}
						}}
					/>
				);
			})}
		</Box>
	);
}
