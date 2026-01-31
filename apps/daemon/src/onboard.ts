/**
 * Onboarding logic for copying template guidance files.
 *
 * This module handles:
 * - Locating template files in the @geniigotchi/guidance package
 * - Checking for existing files in the guidance directory
 * - Copying templates with optional backup
 */

import { copyFile, mkdir, rename, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Logger } from './logging/logger';
import type { OnboardResult, OnboardStatus } from './rpc/methods';

/**
 * Template files to copy during onboarding.
 * These are relative to the templates directory in @geniigotchi/guidance.
 */
const TEMPLATE_FILES = ['SOUL.md', 'INSTRUCTIONS.md'];

/**
 * Get the path to the templates directory in the guidance package.
 */
function getTemplatesPath(): string {
	// Use createRequire to resolve the package location
	const require = createRequire(import.meta.url);
	const guidancePackagePath = require.resolve('@geniigotchi/guidance/package.json');
	return join(dirname(guidancePackagePath), 'templates');
}

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
	const templatesPath = getTemplatesPath();

	logger.debug({ templatesPath, guidancePath }, 'Checking onboard status');

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
 * Copies template files to the guidance directory, optionally creating backups.
 */
export async function executeOnboard(config: OnboardConfig, options: OnboardExecuteOptions): Promise<OnboardResult> {
	const { guidancePath, logger } = config;
	const { backup, dryRun } = options;
	const templatesPath = getTemplatesPath();

	logger.info({ guidancePath, backup, dryRun }, 'Executing onboard');

	const copied: string[] = [];
	const backedUp: string[] = [];
	const skipped: string[] = [];

	// Ensure the guidance directory exists
	if (!dryRun) {
		await mkdir(guidancePath, { recursive: true });
	}

	for (const file of TEMPLATE_FILES) {
		const srcPath = join(templatesPath, file);
		const destPath = join(guidancePath, file);
		const backupPath = `${destPath}.bak`;

		logger.debug({ file, srcPath, destPath }, 'Processing template file');

		// Check if source exists
		if (!(await fileExists(srcPath))) {
			logger.warn({ srcPath }, 'Template file not found, skipping');
			continue;
		}

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

		// Copy the template file
		await copyFile(srcPath, destPath);
		copied.push(file);
		logger.debug({ file }, 'Copied template file');
	}

	logger.info({ copied, backedUp, skipped }, 'Onboard complete');

	return { copied, backedUp, skipped };
}
