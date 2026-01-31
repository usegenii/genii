/**
 * Guidance system types.
 */

import type { Disposable } from '../types/core';
import type { Logger } from '../types/logger';

/**
 * Context for accessing guidance documents.
 */
export interface GuidanceContext {
	/** Root path of the guidance folder */
	readonly root: string;
	/** Content of SOUL.md */
	readonly soul: string;
	/** Content of INSTRUCTIONS.md */
	readonly instructions: string;

	/**
	 * Load a task document by ID.
	 */
	loadTask(taskId: string): Promise<TaskDocument | null>;

	/**
	 * List all available tasks.
	 */
	listTasks(): Promise<TaskInfo[]>;

	/**
	 * Load a skill bundle by path.
	 */
	loadSkill(skillPath: string): Promise<SkillBundle | null>;

	/**
	 * List all available skills.
	 */
	listSkills(): Promise<SkillInfo[]>;

	/**
	 * Memory system for persistent storage.
	 */
	readonly memory: MemorySystem;
}

/**
 * A task document loaded from the guidance folder.
 */
export interface TaskDocument {
	/** Task ID (from filename or frontmatter) */
	id: string;
	/** Task title */
	title: string;
	/** Full markdown content */
	content: string;
	/** Frontmatter metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Information about an available task.
 */
export interface TaskInfo {
	/** Task ID */
	id: string;
	/** Task title */
	title: string;
	/** Short description of the task (from frontmatter) */
	description?: string;
	/** Path to the task file */
	path: string;
}

/**
 * A skill bundle loaded from the guidance folder.
 */
export interface SkillBundle {
	/** Path to the skill folder */
	path: string;
	/** Content of README.md */
	readme: string;
	/** Additional artifacts (filename -> content) */
	artifacts: Map<string, string>;
}

/**
 * Information about an available skill.
 */
export interface SkillInfo {
	/** Path to the skill folder */
	path: string;
	/** Skill name (folder name) */
	name: string;
}

/**
 * Memory system for persistent storage.
 */
export interface MemorySystem {
	/**
	 * Read a markdown file from memory.
	 * @param path - Relative path within the memories folder
	 * @returns File content or null if not found
	 */
	read(path: string): Promise<string | null>;

	/**
	 * Write a markdown file to memory.
	 * @param path - Relative path within the memories folder
	 * @param content - Content to write
	 */
	write(path: string, content: string): Promise<void>;

	/**
	 * Delete a file from memory.
	 * @param path - Relative path within the memories folder
	 */
	delete(path: string): Promise<void>;

	/**
	 * List files in memory.
	 * @param pattern - Optional glob pattern to filter files
	 */
	list(pattern?: string): Promise<string[]>;

	/**
	 * Get a JSON state value.
	 * @param key - State key
	 */
	getState<T>(key: string): Promise<T | null>;

	/**
	 * Set a JSON state value.
	 * @param key - State key
	 * @param value - Value to set
	 */
	setState<T>(key: string, value: T): Promise<void>;

	/**
	 * Atomically update a JSON state value.
	 * @param key - State key
	 * @param fn - Update function
	 */
	updateState<T>(key: string, fn: (current: T | null) => T): Promise<void>;

	/**
	 * List all state keys.
	 */
	listStateKeys(): Promise<string[]>;

	/**
	 * Subscribe to write events.
	 * @param handler - Handler called when a file is written
	 * @returns Disposable to unsubscribe
	 */
	onWrite(handler: (path: string, content: string) => void): Disposable;

	/**
	 * Subscribe to delete events.
	 * @param handler - Handler called when a file is deleted
	 * @returns Disposable to unsubscribe
	 */
	onDelete(handler: (path: string) => void): Disposable;
}

/**
 * Options for creating a guidance context.
 */
export interface GuidanceContextOptions {
	/** Path to the guidance folder */
	root: string;
	/** Logger for guidance context events */
	logger?: Logger;
}

/**
 * Write event for memory tracking.
 */
export interface MemoryWrite {
	path: string;
	content: string;
	timestamp: number;
}

/**
 * Delete event for memory tracking.
 */
export interface MemoryDelete {
	path: string;
	timestamp: number;
}

/**
 * Checkpoint data for the guidance system.
 */
export interface GuidanceCheckpoint {
	/** Path to the guidance folder */
	guidancePath: string;
	/** Memory writes since last checkpoint */
	memoryWrites: MemoryWrite[];
	/** System state values */
	systemState: Record<string, unknown>;
}
