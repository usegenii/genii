/**
 * Hook for keyboard input handling.
 * @module tui/hooks/use-keyboard
 */

import { useInput } from 'ink';
import { useCallback, useState } from 'react';
import type { View } from '../app';

/**
 * Options for the useKeyboard hook.
 */
export interface UseKeyboardOptions {
	/** Callback when quit key is pressed */
	onQuit?: () => void;
	/** Callback when help key is pressed */
	onHelp?: () => void;
	/** Callback when navigation key is pressed */
	onNavigate?: (view: View) => void;
	/** Callback when escape is pressed */
	onEscape?: () => void;
	/** Callback when enter is pressed */
	onEnter?: () => void;
	/** Callback when up arrow is pressed */
	onUp?: () => void;
	/** Callback when down arrow is pressed */
	onDown?: () => void;
	/** Callback for custom key handlers */
	onKey?: (key: string) => void;
	/** Whether keyboard input is enabled */
	enabled?: boolean;
}

/**
 * Hook for handling keyboard input in the TUI.
 */
export function useKeyboard(options: UseKeyboardOptions = {}): void {
	const { onQuit, onHelp, onNavigate, onEscape, onEnter, onUp, onDown, onKey, enabled = true } = options;

	useInput(
		(input, key) => {
			// Quit
			if (input === 'q') {
				onQuit?.();
				return;
			}

			// Help
			if (input === '?') {
				onHelp?.();
				return;
			}

			// Navigation by number
			if (input === '1') {
				onNavigate?.('dashboard');
				return;
			}
			if (input === '2') {
				onNavigate?.('agents');
				return;
			}
			if (input === '3') {
				onNavigate?.('channels');
				return;
			}
			if (input === '4') {
				onNavigate?.('logs');
				return;
			}

			// Escape
			if (key.escape) {
				onEscape?.();
				return;
			}

			// Enter
			if (key.return) {
				onEnter?.();
				return;
			}

			// Arrow keys / vim keys
			if (key.upArrow || input === 'k') {
				onUp?.();
				return;
			}
			if (key.downArrow || input === 'j') {
				onDown?.();
				return;
			}

			// Custom key handler
			if (input && onKey) {
				onKey(input);
			}
		},
		{ isActive: enabled },
	);
}

/**
 * Hook for handling list navigation.
 */
export interface UseListNavigationOptions {
	/** Total number of items */
	itemCount: number;
	/** Callback when selection changes */
	onSelectionChange?: (index: number) => void;
	/** Callback when item is selected (enter pressed) */
	onSelect?: (index: number) => void;
	/** Initial selected index */
	initialIndex?: number;
	/** Whether navigation is enabled */
	enabled?: boolean;
}

/**
 * State returned by useListNavigation.
 */
export interface UseListNavigationResult {
	/** Currently selected index */
	selectedIndex: number;
	/** Move selection up */
	moveUp: () => void;
	/** Move selection down */
	moveDown: () => void;
	/** Set selection to specific index */
	setIndex: (index: number) => void;
}

/**
 * Hook for list navigation with keyboard.
 */
export function useListNavigation(options: UseListNavigationOptions): UseListNavigationResult {
	const { itemCount, onSelectionChange, onSelect, initialIndex = 0, enabled = true } = options;

	const [selectedIndex, setSelectedIndex] = useState(initialIndex);

	const moveUp = useCallback(() => {
		setSelectedIndex((prev) => {
			if (prev > 0) {
				const newIndex = prev - 1;
				onSelectionChange?.(newIndex);
				return newIndex;
			}
			return prev;
		});
	}, [onSelectionChange]);

	const moveDown = useCallback(() => {
		setSelectedIndex((prev) => {
			if (prev < itemCount - 1) {
				const newIndex = prev + 1;
				onSelectionChange?.(newIndex);
				return newIndex;
			}
			return prev;
		});
	}, [itemCount, onSelectionChange]);

	const setIndex = useCallback(
		(index: number) => {
			if (index >= 0 && index < itemCount) {
				setSelectedIndex(index);
				onSelectionChange?.(index);
			}
		},
		[itemCount, onSelectionChange],
	);

	useKeyboard({
		onUp: moveUp,
		onDown: moveDown,
		onEnter: () => onSelect?.(selectedIndex),
		enabled,
	});

	return {
		selectedIndex,
		moveUp,
		moveDown,
		setIndex,
	};
}
