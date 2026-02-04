/**
 * Tree select component for hierarchical navigation.
 * @module tui/onboarding/components/tree-select
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { useTerminalTheme } from '../hooks/use-terminal-theme';
import { useWizardKeyboard } from '../hooks/use-wizard-keyboard';

export interface TreeNode {
	id: string;
	label: string;
	children?: TreeNode[];
}

export interface TreeSelectProps {
	/** Tree nodes */
	nodes: TreeNode[];
	/** Currently highlighted node path (array of IDs) */
	highlightedPath: string[];
	/** Highlight change handler (called on navigation) */
	onHighlight: (path: string[]) => void;
	/** Confirm handler (called on Enter) */
	onConfirm?: (path: string[]) => void;
	/** Whether the component is focused */
	isFocused?: boolean;
}

/**
 * Tree select with keyboard navigation.
 */
export function TreeSelect({
	nodes,
	highlightedPath,
	onHighlight,
	onConfirm,
	isFocused = true,
}: TreeSelectProps): React.ReactElement {
	const theme = useTerminalTheme();
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

	// Flatten visible nodes for navigation
	const visibleNodes: { node: TreeNode; path: string[]; depth: number }[] = [];

	function addVisibleNodes(nodeList: TreeNode[], parentPath: string[], depth: number) {
		for (const node of nodeList) {
			const nodePath = [...parentPath, node.id];
			visibleNodes.push({ node, path: nodePath, depth });

			const pathKey = nodePath.join('/');
			if (node.children && expandedPaths.has(pathKey)) {
				addVisibleNodes(node.children, nodePath, depth + 1);
			}
		}
	}
	addVisibleNodes(nodes, [], 0);

	const currentPathKey = highlightedPath.join('/');
	const currentIndex = visibleNodes.findIndex((v) => v.path.join('/') === currentPathKey);

	useWizardKeyboard({
		enabled: isFocused,
		onUp: () => {
			const prevNode = visibleNodes[currentIndex - 1];
			if (currentIndex > 0 && prevNode) {
				onHighlight(prevNode.path);
			}
		},
		onDown: () => {
			const nextNode = visibleNodes[currentIndex + 1];
			if (currentIndex < visibleNodes.length - 1 && nextNode) {
				onHighlight(nextNode.path);
			}
		},
		onRight: () => {
			const current = visibleNodes[currentIndex];
			if (current?.node.children) {
				setExpandedPaths((prev) => new Set([...prev, currentPathKey]));
			}
		},
		onLeft: () => {
			if (expandedPaths.has(currentPathKey)) {
				setExpandedPaths((prev) => {
					const next = new Set(prev);
					next.delete(currentPathKey);
					return next;
				});
			} else if (highlightedPath.length > 1) {
				onHighlight(highlightedPath.slice(0, -1));
			}
		},
		onNext: () => {
			const current = visibleNodes[currentIndex];
			if (current?.node.children) {
				// Expand if has children
				setExpandedPaths((prev) => new Set([...prev, currentPathKey]));
			} else {
				// Confirm selection if leaf node
				onConfirm?.(highlightedPath);
			}
		},
	});

	return (
		<Box flexDirection="column">
			{visibleNodes.map(({ node, path, depth }) => {
				const pathKey = path.join('/');
				const isSelected = pathKey === currentPathKey;
				const isExpanded = expandedPaths.has(pathKey);
				const hasChildren = Boolean(node.children?.length);

				return (
					<Box key={pathKey} marginLeft={depth * 2}>
						<Text color={isSelected ? theme.primary : theme.muted}>{isSelected ? '> ' : '  '}</Text>
						{hasChildren && <Text color={theme.muted}>{isExpanded ? '▼ ' : '▶ '}</Text>}
						<Text color={isSelected ? theme.label : theme.muted} bold={isSelected}>
							{node.label}
						</Text>
					</Box>
				);
			})}
		</Box>
	);
}
