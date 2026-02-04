/**
 * Hook for consistent terminal theming.
 * @module tui/onboarding/hooks/use-terminal-theme
 */

/**
 * Theme colors for the terminal UI.
 */
export interface TerminalTheme {
	/** Primary accent color */
	primary: string;
	/** Secondary/muted accent color */
	secondary: string;
	/** Success state color */
	success: string;
	/** Error state color */
	error: string;
	/** Warning state color */
	warning: string;
	/** Muted/disabled text color */
	muted: string;
	/** Text for labels/headers */
	label: string;
	/** Text for hints/descriptions */
	hint: string;
	/** Selection/focus indicator */
	selection: string;
}

/**
 * Default terminal theme.
 */
const DEFAULT_THEME: TerminalTheme = {
	primary: 'cyan',
	secondary: 'blue',
	success: 'green',
	error: 'red',
	warning: 'yellow',
	muted: 'gray',
	label: 'white',
	hint: 'gray',
	selection: 'cyan',
};

/**
 * Hook that provides consistent theming for the wizard.
 * @returns The terminal theme object
 */
export function useTerminalTheme(): TerminalTheme {
	// Future: could detect terminal capabilities and adjust
	return DEFAULT_THEME;
}
