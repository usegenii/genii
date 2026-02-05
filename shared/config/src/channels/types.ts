/**
 * Channel definition types for config-driven channel setup.
 * @module config/channels/types
 */

import type { SetupField } from '../providers/types.js';

// Re-export SetupField for convenience
export type { SetupField, SetupFieldOption, SetupFieldType } from '../providers/types.js';

/**
 * Definition of a channel type (built-in or custom).
 */
export interface ChannelDefinition {
	id: string;
	name: string;
	description: string;
	credentialField: SetupField;
	fields: SetupField[];
	defaults?: Record<string, string>;
}
