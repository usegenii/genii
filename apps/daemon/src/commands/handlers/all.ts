/**
 * All command handlers.
 *
 * This file exports all command handlers as an array for registration.
 */

import type { SlashCommand } from '../types';
import { newCommand } from './new';

/**
 * All registered slash commands.
 */
export const allCommands: SlashCommand[] = [newCommand];
