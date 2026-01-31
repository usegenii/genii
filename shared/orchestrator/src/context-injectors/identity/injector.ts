/**
 * Identity context injector.
 *
 * Injects IDENTITY.md and HUMAN.md content into the agent's system prompt.
 * These files define the agent's formed identity and information about their human.
 * Always includes paths where these files should be located.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CheckpointMessage } from '../../snapshot/types';
import { INJECTOR_ORDER } from '../order';
import type { ContextInjector, InjectorContext } from '../types';

/**
 * Load a file from a path, returning null if not found.
 */
async function loadFile(path: string): Promise<string | null> {
	try {
		return await readFile(path, 'utf-8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

/**
 * Identity context injector.
 *
 * This injector provides the IDENTITY.md and HUMAN.md content.
 * It always includes the paths where these files should be located,
 * regardless of whether they exist.
 */
export class IdentityContextInjector implements ContextInjector {
	readonly name = 'identity';
	readonly order = INJECTOR_ORDER.IDENTITY;

	/**
	 * Inject the identity and human content into the system prompt.
	 * @param ctx - The injector context
	 * @returns Identity context including paths and file contents if available
	 */
	async injectSystemContext(ctx: InjectorContext): Promise<string | undefined> {
		const root = ctx.guidancePath ?? ctx.guidance?.root;
		if (!root) {
			return undefined;
		}

		const identityPath = join(root, 'IDENTITY.md');
		const humanPath = join(root, 'HUMAN.md');

		// Load files in parallel
		const [identityContent, humanContent] = await Promise.all([loadFile(identityPath), loadFile(humanPath)]);

		const parts: string[] = [];

		// Always include paths section
		parts.push('<identity-files>');
		parts.push(`<identity-path>${identityPath}</identity-path>`);
		parts.push(`<human-path>${humanPath}</human-path>`);
		parts.push('</identity-files>');

		// Include identity content if it exists
		if (identityContent) {
			parts.push('');
			parts.push('<identity>');
			parts.push(identityContent.trim());
			parts.push('</identity>');
		}

		// Include human content if it exists
		if (humanContent) {
			parts.push('');
			parts.push('<human>');
			parts.push(humanContent.trim());
			parts.push('</human>');
		}

		return parts.join('\n');
	}

	/**
	 * No resume context for identity - it's reloaded fresh each session.
	 */
	injectResumeContext(_ctx: InjectorContext): CheckpointMessage[] | undefined {
		return undefined;
	}
}
