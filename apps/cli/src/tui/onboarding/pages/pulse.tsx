/**
 * Pulse configuration page for the onboarding wizard.
 * @module tui/onboarding/pages/pulse
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { SelectField, type SelectOption } from '../components/select-field';
import { ToggleField } from '../components/toggle-field';
import { useWizard } from '../context';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';
import type { PulseState } from '../types';

const INTERVAL_OPTIONS: SelectOption[] = [
	{ value: '15m', label: 'Every 15 minutes' },
	{ value: '30m', label: 'Every 30 minutes' },
	{ value: '1h', label: 'Every hour' },
	{ value: '2h', label: 'Every 2 hours' },
	{ value: '4h', label: 'Every 4 hours' },
	{ value: '6h', label: 'Every 6 hours' },
];

/**
 * Convert interval to cron format preview.
 */
function intervalToCron(interval: string): string {
	switch (interval) {
		case '15m':
			return '*/15 * * * *';
		case '30m':
			return '*/30 * * * *';
		case '1h':
			return '0 * * * *';
		case '2h':
			return '0 */2 * * *';
		case '4h':
			return '0 */4 * * *';
		case '6h':
			return '0 */6 * * *';
		default:
			return '0 * * * *';
	}
}

type FocusedField = 'toggle' | 'interval';

/**
 * Pulse configuration page.
 */
export function PulsePage(): React.ReactElement {
	const theme = useTerminalTheme();
	const { state, dispatch } = useWizard();
	const [focusedField, setFocusedField] = useState<FocusedField>('toggle');

	// Handle escape to go back
	useWizardKeyboard({
		enabled: true,
		onBack: () => dispatch({ type: 'PREV_PAGE' }),
	});

	// Handle down arrow on toggle to move to interval (only when pulse is enabled)
	useWizardKeyboard({
		enabled: focusedField === 'toggle' && state.pulse.enabled,
		onDown: () => setFocusedField('interval'),
	});

	return (
		<Box flexDirection="column" paddingX={2}>
			<Box marginBottom={1}>
				<Text color={theme.primary} bold>
					Pulse Configuration
				</Text>
			</Box>

			<Box marginBottom={1} flexDirection="column">
				<Text color={theme.hint}>Pulse enables Genii to proactively check in and work on tasks.</Text>
				<Text color={theme.hint}>When enabled, Genii will periodically review your PULSE.md file.</Text>
			</Box>

			<Box flexDirection="column" gap={1}>
				<ToggleField
					label="Enable Pulse"
					value={state.pulse.enabled}
					onChange={(enabled) => {
						dispatch({ type: 'SET_PULSE', pulse: { enabled } });
						// Reset focus to toggle when disabling
						if (!enabled) {
							setFocusedField('toggle');
						}
					}}
					description="Allow Genii to work proactively on scheduled intervals"
					isFocused={focusedField === 'toggle'}
				/>

				{state.pulse.enabled && (
					<>
						<SelectField
							label="Check Interval"
							options={INTERVAL_OPTIONS}
							value={state.pulse.interval}
							onChange={(value) =>
								dispatch({ type: 'SET_PULSE', pulse: { interval: value as PulseState['interval'] } })
							}
							isFocused={focusedField === 'interval'}
							onBoundaryUp={() => setFocusedField('toggle')}
						/>

						<Box marginTop={1}>
							<Text color={theme.muted}>
								Cron: <Text color={theme.secondary}>{intervalToCron(state.pulse.interval)}</Text>
							</Text>
						</Box>
					</>
				)}

				<Box marginTop={1}>
					<Text color={theme.hint}>
						{state.pulse.enabled
							? 'Use ↑/↓ to navigate, Space to select, Enter to continue'
							: 'Press Space to enable, Enter to continue'}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
