/**
 * Guidance context implementation.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Logger, noopLogger } from '../types/logger';
import { listSkills, listTasks, loadSkillBundle, loadTaskDocument } from './loaders';
import { MemorySystemImpl } from './memory';
import type {
	GuidanceContext,
	GuidanceContextOptions,
	MemorySystem,
	SkillBundle,
	SkillInfo,
	TaskDocument,
	TaskInfo,
} from './types';

/**
 * Implementation of GuidanceContext.
 */
export class GuidanceContextImpl implements GuidanceContext {
	readonly root: string;
	private _soul: string | null = null;
	private _instructions: string | null = null;
	private _memory: MemorySystem | null = null;
	private taskCache = new Map<string, TaskDocument | null>();
	private skillCache = new Map<string, SkillBundle | null>();
	private logger: Logger;

	constructor(options: GuidanceContextOptions) {
		this.root = options.root;
		this.logger = options.logger ?? noopLogger;
	}

	/**
	 * Get the SOUL.md content.
	 * Throws if not yet loaded.
	 */
	get soul(): string {
		if (this._soul === null) {
			throw new Error('GuidanceContext not initialized. Call initialize() first.');
		}
		return this._soul;
	}

	/**
	 * Get the INSTRUCTIONS.md content.
	 * Throws if not yet loaded.
	 */
	get instructions(): string {
		if (this._instructions === null) {
			throw new Error('GuidanceContext not initialized. Call initialize() first.');
		}
		return this._instructions;
	}

	/**
	 * Get the memory system.
	 */
	get memory(): MemorySystem {
		if (this._memory === null) {
			this._memory = new MemorySystemImpl(this.root);
		}
		return this._memory;
	}

	/**
	 * Initialize the context by loading SOUL.md and INSTRUCTIONS.md.
	 */
	async initialize(): Promise<void> {
		this.logger.debug({ root: this.root }, 'Initializing guidance context');

		const [soul, instructions] = await Promise.all([this.loadFile('SOUL.md'), this.loadFile('INSTRUCTIONS.md')]);

		this._soul = soul ?? '';
		this._instructions = instructions ?? '';

		this.logger.info(
			{
				root: this.root,
				soulLoaded: soul !== null,
				soulLength: this._soul.length,
				instructionsLoaded: instructions !== null,
				instructionsLength: this._instructions.length,
			},
			'Guidance context initialized',
		);
	}

	/**
	 * Load a task document by ID.
	 */
	async loadTask(taskId: string): Promise<TaskDocument | null> {
		// Check cache
		if (this.taskCache.has(taskId)) {
			return this.taskCache.get(taskId) ?? null;
		}

		// Try to find task file
		const tasksDir = join(this.root, 'tasks');
		const taskPath = join(tasksDir, `${taskId}.md`);

		const doc = await loadTaskDocument(taskPath);
		this.taskCache.set(taskId, doc);
		return doc;
	}

	/**
	 * List all available tasks.
	 */
	async listTasks(): Promise<TaskInfo[]> {
		const tasksDir = join(this.root, 'tasks');
		return listTasks(tasksDir);
	}

	/**
	 * Load a skill bundle by path.
	 */
	async loadSkill(skillPath: string): Promise<SkillBundle | null> {
		// Check cache
		if (this.skillCache.has(skillPath)) {
			return this.skillCache.get(skillPath) ?? null;
		}

		// Resolve skill path
		const skillsDir = join(this.root, 'skills');
		const fullPath = join(skillsDir, skillPath);

		const bundle = await loadSkillBundle(fullPath);
		this.skillCache.set(skillPath, bundle);
		return bundle;
	}

	/**
	 * List all available skills.
	 */
	async listSkills(): Promise<SkillInfo[]> {
		const skillsDir = join(this.root, 'skills');
		return listSkills(skillsDir);
	}

	/**
	 * Load a file from the guidance folder.
	 */
	private async loadFile(filename: string): Promise<string | null> {
		const path = join(this.root, filename);
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
	 * Clear all caches.
	 */
	clearCaches(): void {
		this.taskCache.clear();
		this.skillCache.clear();
	}
}

/**
 * Create and initialize a guidance context.
 */
export async function createGuidanceContext(options: GuidanceContextOptions): Promise<GuidanceContext> {
	const context = new GuidanceContextImpl(options);
	await context.initialize();
	return context;
}

/**
 * Create an uninitialized guidance context.
 * You must call initialize() before using it.
 */
export function createGuidanceContextSync(options: GuidanceContextOptions): GuidanceContextImpl {
	return new GuidanceContextImpl(options);
}
