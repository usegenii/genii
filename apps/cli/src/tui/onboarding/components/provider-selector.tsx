/**
 * Provider selector component for the onboarding wizard.
 * @module tui/onboarding/components/provider-selector
 */

import {
	type AuthMethod,
	BUILTIN_PROVIDERS,
	CUSTOM_PROVIDER_DEFINITION,
	type ProviderDefinition,
} from '@genii/config/providers/definitions';
import { Box, Text } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import type { ExistingConfig, ExistingProviderInfo } from '../types';
import { type TreeNode, TreeSelect } from './tree-select';

export interface ProviderSelectorProps {
	/** Called when a provider is selected */
	onSelect: (provider: ProviderDefinition, authMethod: AuthMethod, existingInfo?: ExistingProviderInfo) => void;
	/** Whether the component is focused */
	isFocused?: boolean;
	/** Initial selected path */
	initialPath?: string[];
	/** Existing configuration for showing configured badges */
	existingConfig?: ExistingConfig;
}

/**
 * Build tree nodes from provider definitions.
 * Includes auth method selection for providers with multiple auth methods.
 */
function buildProviderTree(existingConfig?: ExistingConfig): TreeNode[] {
	// Create a set of configured provider IDs for quick lookup
	const configuredProviderIds = new Set(existingConfig?.providers.map((p) => p.providerId) ?? []);
	const builtinIds = new Set(BUILTIN_PROVIDERS.map((p) => p.id));

	// Find configured custom providers (non-builtin)
	const configuredCustomProviders = existingConfig?.providers.filter((p) => !builtinIds.has(p.providerId)) ?? [];

	const builtinNodes: TreeNode[] = BUILTIN_PROVIDERS.map((p: ProviderDefinition) => {
		const isConfigured = configuredProviderIds.has(p.id);
		const label = isConfigured ? `${p.name} [configured]` : p.name;

		// If provider has multiple auth methods, add them as children
		if (p.authMethods.length > 1) {
			return {
				id: p.id,
				label,
				children: p.authMethods.map((auth) => ({
					id: auth.type,
					label: auth.name,
				})),
			};
		}
		// Single auth method - no children needed
		return {
			id: p.id,
			label,
		};
	});

	// Build custom provider node
	const customNode: TreeNode =
		CUSTOM_PROVIDER_DEFINITION.authMethods.length > 1
			? {
					id: 'custom',
					label: 'Custom Provider',
					children: CUSTOM_PROVIDER_DEFINITION.authMethods.map((auth) => ({
						id: auth.type,
						label: auth.name,
					})),
				}
			: {
					id: 'custom',
					label: 'Custom Provider',
				};

	const nodes: TreeNode[] = [
		{
			id: 'builtin',
			label: 'Built-in Providers',
			children: builtinNodes,
		},
		customNode,
	];

	// Add configured custom providers section if any exist
	if (configuredCustomProviders.length > 0) {
		const configuredCustomNodes: TreeNode[] = configuredCustomProviders.map((p) => ({
			id: p.providerId,
			label: `${p.providerId} [configured]`,
		}));

		nodes.push({
			id: 'configured-custom',
			label: 'Configured Custom Providers',
			children: configuredCustomNodes,
		});
	}

	return nodes;
}

/**
 * Provider selector with tree navigation.
 * Handles provider selection and auth method selection.
 */
export function ProviderSelector({
	onSelect,
	isFocused = true,
	initialPath = ['builtin'],
	existingConfig,
}: ProviderSelectorProps): React.ReactElement {
	const theme = useTerminalTheme();
	const [selectedPath, setSelectedPath] = useState<string[]>(initialPath);
	const providerTree = buildProviderTree(existingConfig);

	const handlePathHighlight = (path: string[]) => {
		setSelectedPath(path);
	};

	const handlePathConfirm = (path: string[]) => {
		// Helper to find existing provider info
		const findExistingInfo = (providerId: string): ExistingProviderInfo | undefined => {
			return existingConfig?.providers.find((p) => p.providerId === providerId);
		};

		// Handle custom provider selection (no parent category)
		if (path.length === 1 && path[0] === 'custom') {
			const authMethod = CUSTOM_PROVIDER_DEFINITION.authMethods[0];
			if (authMethod) {
				onSelect(CUSTOM_PROVIDER_DEFINITION, authMethod);
			}
			return;
		}

		// Handle custom provider with auth method selection
		if (path.length === 2 && path[0] === 'custom') {
			const authMethod = CUSTOM_PROVIDER_DEFINITION.authMethods.find((a) => a.type === path[1]);
			if (authMethod) {
				onSelect(CUSTOM_PROVIDER_DEFINITION, authMethod);
			}
			return;
		}

		// Handle configured custom provider selection (path: ['configured-custom', providerId])
		if (path.length === 2 && path[0] === 'configured-custom') {
			const providerId = path[1];
			if (!providerId) return;
			const existingInfo = findExistingInfo(providerId);
			if (existingInfo) {
				// Use custom provider definition for configured custom providers
				const authMethod = CUSTOM_PROVIDER_DEFINITION.authMethods[0];
				if (authMethod) {
					onSelect(CUSTOM_PROVIDER_DEFINITION, authMethod, existingInfo);
				}
			}
			return;
		}

		// Handle builtin provider selection (path: ['builtin', providerId])
		if (path.length === 2 && path[0] === 'builtin') {
			const provider = BUILTIN_PROVIDERS.find((p) => p.id === path[1]);
			if (provider) {
				// If provider has single auth method, select it directly
				if (provider.authMethods.length === 1) {
					const authMethod = provider.authMethods[0];
					if (authMethod) {
						const existingInfo = findExistingInfo(provider.id);
						onSelect(provider, authMethod, existingInfo);
					}
				}
				// If multiple auth methods, tree will expand for user to select
			}
			return;
		}

		// Handle builtin provider with auth method selection (path: ['builtin', providerId, authType])
		if (path.length === 3 && path[0] === 'builtin') {
			const provider = BUILTIN_PROVIDERS.find((p) => p.id === path[1]);
			if (provider) {
				const authMethod = provider.authMethods.find((a) => a.type === path[2]);
				if (authMethod) {
					const existingInfo = findExistingInfo(provider.id);
					onSelect(provider, authMethod, existingInfo);
				}
			}
		}
	};

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text color={theme.hint}>Select a provider to configure:</Text>
			</Box>
			<TreeSelect
				nodes={providerTree}
				highlightedPath={selectedPath}
				onHighlight={handlePathHighlight}
				onConfirm={handlePathConfirm}
				isFocused={isFocused}
			/>
		</Box>
	);
}
