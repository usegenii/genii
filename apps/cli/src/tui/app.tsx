/**
 * Root Ink component for the TUI application.
 * @module tui/app
 */

import { Box, Text, useApp } from 'ink';
import type React from 'react';
import { useCallback, useState } from 'react';
import { HelpModal } from './components/help-modal';
import { StatusBar } from './components/status-bar';
import { useDaemon } from './hooks/use-daemon';
import { useKeyboard } from './hooks/use-keyboard';
import { AgentDetail } from './views/agent-detail';
import { Agents } from './views/agents';
import { Channels } from './views/channels';
import { Dashboard } from './views/dashboard';
import { Logs } from './views/logs';

/**
 * Available views in the TUI.
 */
export type View = 'dashboard' | 'agents' | 'agent-detail' | 'channels' | 'logs';

/**
 * Props for the App component.
 */
export interface AppProps {
	/** Initial view to display */
	initialView?: View;
	/** Refresh interval in milliseconds */
	refreshInterval?: number;
}

/**
 * Root TUI application component.
 */
export function App({ initialView = 'dashboard', refreshInterval = 1000 }: AppProps): React.ReactElement {
	const { exit } = useApp();
	const [currentView, setCurrentView] = useState<View>(initialView);
	const [previousView, setPreviousView] = useState<View>('dashboard');
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [showHelp, setShowHelp] = useState(false);

	const { connected, error } = useDaemon({ refreshInterval });

	// Handle view navigation
	const navigateToView = useCallback(
		(view: View) => {
			if (view !== currentView) {
				setPreviousView(currentView);
				setCurrentView(view);
			}
		},
		[currentView],
	);

	// Handle agent selection
	const handleAgentSelect = useCallback(
		(agentId: string) => {
			setSelectedAgentId(agentId);
			setPreviousView(currentView);
			setCurrentView('agent-detail');
		},
		[currentView],
	);

	// Handle back navigation
	const handleBack = useCallback(() => {
		setSelectedAgentId(null);
		setCurrentView(previousView === 'agent-detail' ? 'agents' : previousView);
	}, [previousView]);

	// Handle escape key for modals and navigation
	const handleEscape = useCallback(() => {
		if (showHelp) {
			setShowHelp(false);
		} else if (currentView === 'agent-detail') {
			handleBack();
		}
	}, [showHelp, currentView, handleBack]);

	// Global keyboard handling
	useKeyboard({
		onQuit: () => exit(),
		onHelp: () => setShowHelp((prev) => !prev),
		onNavigate: navigateToView,
		onEscape: handleEscape,
		enabled: !showHelp, // Disable global shortcuts when help is shown
	});

	// Error state
	if (error && !connected) {
		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={1}>
					<Text bold color="red">
						Connection Error
					</Text>
				</Box>
				<Text color="red">{error}</Text>
				<Box marginTop={1}>
					<Text color="gray">Make sure the daemon is running with 'genii daemon start'</Text>
				</Box>
				<Box marginTop={1}>
					<Text color="gray">
						Press <Text color="yellow">q</Text> to quit
					</Text>
				</Box>
			</Box>
		);
	}

	// Render current view
	const renderView = (): React.ReactElement => {
		switch (currentView) {
			case 'dashboard':
				return <Dashboard />;
			case 'agents':
				return <Agents onSelect={handleAgentSelect} />;
			case 'agent-detail':
				return <AgentDetail agentId={selectedAgentId} onBack={handleBack} />;
			case 'channels':
				return <Channels />;
			case 'logs':
				return <Logs />;
		}
	};

	return (
		<Box flexDirection="column" height="100%">
			{/* Main content area */}
			<Box flexGrow={1}>{renderView()}</Box>

			{/* Status bar at bottom */}
			<StatusBar connected={connected} currentView={currentView} />

			{/* Help modal overlay */}
			{showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
		</Box>
	);
}
