/**
 * Persistence utilities for onboarding wizard state.
 * @module tui/onboarding/persistence
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { OnboardingState } from './types';

/**
 * Get the path to the onboarding state file.
 */
function getStatePath(): string {
	return join(homedir(), '.genii', '.onboarding-state.json');
}

/**
 * Save the onboarding state to disk.
 * @param state - The state to save
 */
export async function saveOnboardingState(state: OnboardingState): Promise<void> {
	const filePath = getStatePath();
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, JSON.stringify(state, null, '\t'), 'utf-8');
}

/**
 * Load the onboarding state from disk.
 * @returns The saved state, or null if no state exists
 */
export async function loadOnboardingState(): Promise<OnboardingState | null> {
	try {
		const filePath = getStatePath();
		const content = await readFile(filePath, 'utf-8');
		return JSON.parse(content) as OnboardingState;
	} catch (error) {
		// Return null if file doesn't exist or is invalid
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return null;
		}
		// Log but don't throw for JSON parse errors
		console.error('Failed to load onboarding state:', error);
		return null;
	}
}

/**
 * Clear the saved onboarding state.
 */
export async function clearOnboardingState(): Promise<void> {
	try {
		await unlink(getStatePath());
	} catch (error) {
		// Ignore if file doesn't exist
		if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
			throw error;
		}
	}
}

/**
 * Check if there is saved onboarding state.
 */
export async function hasOnboardingState(): Promise<boolean> {
	try {
		await readFile(getStatePath(), 'utf-8');
		return true;
	} catch {
		return false;
	}
}
