/**
 * Wizard navigation component.
 * @module tui/onboarding/components/wizard-nav
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { PAGES } from '../types';

export interface WizardNavProps {
	/** Current page index (0-based) */
	currentPage: number;
	/** Whether back navigation is available */
	canGoBack: boolean;
	/** Whether proceeding to next page is allowed */
	canProceed: boolean;
	/** Whether this is the final page */
	isComplete: boolean;
}

/**
 * Navigation bar showing progress and page controls.
 */
export function WizardNav({ currentPage, canGoBack, canProceed, isComplete }: WizardNavProps): React.ReactElement {
	const theme = useTerminalTheme();
	const currentPageInfo = PAGES[currentPage];
	const totalPages = PAGES.length;

	// Build progress indicator
	const progress = PAGES.map((_page, index) => {
		if (index < currentPage) return '●';
		if (index === currentPage) return '◉';
		return '○';
	}).join(' ');

	return (
		<Box flexDirection="column" borderStyle="single" borderColor={theme.muted} padding={1}>
			{/* Header with title and step counter */}
			<Box justifyContent="space-between">
				<Text color={theme.primary} bold>
					{currentPageInfo?.title ?? 'Setup'}
				</Text>
				<Text color={theme.muted}>
					Step {currentPage + 1} of {totalPages}
				</Text>
			</Box>

			{/* Description */}
			<Box marginTop={1}>
				<Text color={theme.hint}>{currentPageInfo?.description ?? ''}</Text>
			</Box>

			{/* Progress dots */}
			<Box marginTop={1} justifyContent="center">
				<Text color={theme.primary}>{progress}</Text>
			</Box>

			{/* Navigation hints */}
			<Box marginTop={1} justifyContent="space-between">
				<Box>{canGoBack && <Text color={theme.muted}>← Esc to go back</Text>}</Box>
				<Box>
					{canProceed && !isComplete && <Text color={theme.success}>Enter to continue →</Text>}
					{canProceed && isComplete && (
						<Text color={theme.success} bold>
							Enter to complete setup →
						</Text>
					)}
				</Box>
			</Box>
		</Box>
	);
}
