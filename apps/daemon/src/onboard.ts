/**
 * Onboarding logic for copying template guidance files.
 *
 * This module handles:
 * - Inlined template files from the guidance package (bundled at build time)
 * - Checking for existing files in the guidance directory
 * - Writing templates with optional backup
 */

import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { templates } from '@geniigotchi/guidance/templates';
import type { Logger } from './logging/logger';
import type { OnboardResult, OnboardStatus } from './rpc/methods';

/**
 * Template files to copy during onboarding.
 * These are the root-level template files.
 */
const TEMPLATE_FILES = ['SOUL.md', 'INSTRUCTIONS.md', 'PULSE.md'];

/**
 * Check if a file exists.
 */
async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Configuration for onboard operations.
 */
export interface OnboardConfig {
	/** Path to the guidance directory where files will be copied */
	guidancePath: string;
	/** Logger instance */
	logger: Logger;
}

/**
 * Get the status of the onboarding operation.
 *
 * Returns information about what files would be copied and which already exist.
 */
export async function getOnboardStatus(config: OnboardConfig): Promise<OnboardStatus> {
	const { guidancePath, logger } = config;

	logger.debug({ guidancePath }, 'Checking onboard status');

	const existing: string[] = [];

	// Check which template files already exist in the guidance directory
	for (const file of TEMPLATE_FILES) {
		const destPath = join(guidancePath, file);
		if (await fileExists(destPath)) {
			existing.push(file);
		}
	}

	return {
		guidancePath,
		templates: [...TEMPLATE_FILES],
		existing,
	};
}

/**
 * Options for executing the onboard operation.
 */
export interface OnboardExecuteOptions {
	/** Create .bak files for overwritten files */
	backup: boolean;
	/** Only report what would be done, don't actually copy */
	dryRun: boolean;
}

/**
 * Execute the onboarding operation.
 *
 * Writes template files to the guidance directory, optionally creating backups.
 * Templates are inlined at build time from the @geniigotchi/guidance package.
 */
export async function executeOnboard(config: OnboardConfig, options: OnboardExecuteOptions): Promise<OnboardResult> {
	const { guidancePath, logger } = config;
	const { backup, dryRun } = options;

	logger.info({ guidancePath, backup, dryRun }, 'Executing onboard');

	const copied: string[] = [];
	const backedUp: string[] = [];
	const skipped: string[] = [];

	// Ensure the guidance directory exists
	if (!dryRun) {
		await mkdir(guidancePath, { recursive: true });
	}

	for (const file of TEMPLATE_FILES) {
		const content = templates.get(file);
		if (!content) {
			logger.warn({ file }, 'Template file not found in bundle, skipping');
			continue;
		}

		const destPath = join(guidancePath, file);
		const backupPath = `${destPath}.bak`;

		logger.debug({ file, destPath }, 'Processing template file');

		if (dryRun) {
			skipped.push(file);
			continue;
		}

		// Check if destination exists and needs backup
		const destExists = await fileExists(destPath);
		if (destExists && backup) {
			logger.debug({ destPath, backupPath }, 'Creating backup');
			await rename(destPath, backupPath);
			backedUp.push(file);
		}

		// Write the template file
		await writeFile(destPath, content, 'utf-8');
		copied.push(file);
		logger.debug({ file }, 'Wrote template file');
	}

	logger.info({ copied, backedUp, skipped }, 'Onboard complete');

	return { copied, backedUp, skipped };
}
