/**
 * Hook for wizard-specific keyboard navigation.
 * @module tui/onboarding/hooks/use-wizard-keyboard
 */

import { useInput } from 'ink';

export interface UseWizardKeyboardOptions {
	/** Callback when Enter is pressed (next/confirm) */
	onNext?: () => void;
	/** Callback when Escape or Backspace is pressed (back) */
	onBack?: () => void;
	/** Callback when Space is pressed (toggle) */
	onToggle?: () => void;
	/** Callback when up arrow or k is pressed */
	onUp?: () => void;
	/** Callback when down arrow or j is pressed */
	onDown?: () => void;
	/** Callback when left arrow or h is pressed */
	onLeft?: () => void;
	/** Callback when right arrow or l is pressed */
	onRight?: () => void;
	/** Callback when Tab is pressed */
	onTab?: () => void;
	/** Whether keyboard input is enabled */
	enabled?: boolean;
}

/**
 * Hook for handling wizard keyboard navigation.
 */
export function useWizardKeyboard(options: UseWizardKeyboardOptions = {}): void {
	const { onNext, onBack, onToggle, onUp, onDown, onLeft, onRight, onTab, enabled = true } = options;

	useInput(
		(input, key) => {
			// Enter - next/confirm
			if (key.return) {
				onNext?.();
				return;
			}

			// Escape or Backspace - back
			if (key.escape || key.backspace) {
				onBack?.();
				return;
			}

			// Space - toggle
			if (input === ' ') {
				onToggle?.();
				return;
			}

			// Arrow keys and vim bindings
			if (key.upArrow || input === 'k') {
				onUp?.();
				return;
			}
			if (key.downArrow || input === 'j') {
				onDown?.();
				return;
			}
			if (key.leftArrow || input === 'h') {
				onLeft?.();
				return;
			}
			if (key.rightArrow || input === 'l') {
				onRight?.();
				return;
			}

			// Tab - for field navigation
			if (key.tab) {
				onTab?.();
				return;
			}
		},
		{ isActive: enabled },
	);
}
