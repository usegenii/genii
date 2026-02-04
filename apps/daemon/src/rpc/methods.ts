/**
 * RPC method type definitions.
 *
 * This module defines the types for all RPC methods:
 * - Method names
 * - Parameter types
 * - Return types
 */

import type { Destination } from '@genii/comms/destination/types';
import type { ChannelId, ChannelStatus } from '@genii/comms/types/core';
import type {
	AgentFilter,
	AgentInput,
	AgentSessionId,
	AgentSnapshot,
	AgentStatus,
} from '@genii/orchestrator/types/core';
import type { ConversationBinding, ConversationFilter } from '../conversations/types';

// =============================================================================
// Daemon Lifecycle Methods
// =============================================================================

/**
 * Daemon status information.
 */
export interface DaemonStatus {
	/** Current status of the daemon */
	status: 'running' | 'stopping';
	/** Uptime in milliseconds */
	uptimeMs: number;
	/** Number of running agents */
	agentCount: number;
	/** Number of connected channels */
	channelCount: number;
	/** Daemon version */
	version: string;
}

// =============================================================================
// Agent Types
// =============================================================================

/**
 * Summary information about an agent.
 */
export interface AgentSummary {
	/** Agent session ID */
	id: AgentSessionId;
	/** Current status */
	status: AgentStatus;
	/** Tags applied to the agent */
	tags?: string[];
	/** When the agent was created */
	createdAt: string;
}

/**
 * Detailed information about an agent.
 */
export interface AgentDetails extends AgentSummary {
	/** Guidance path used (may be undefined if using default) */
	guidancePath?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
	/** Parent agent ID if this is a child agent */
	parentId?: AgentSessionId;
}

// =============================================================================
// Channel Types
// =============================================================================

/**
 * Summary information about a channel.
 */
export interface ChannelSummary {
	/** Channel ID */
	id: ChannelId;
	/** Adapter type name */
	type: string;
	/** Current connection status */
	status: ChannelStatus;
}

/**
 * Detailed information about a channel.
 */
export interface ChannelDetails extends ChannelSummary {
	/** When the channel was registered */
	registeredAt?: string;
	/** Additional configuration (safe subset) */
	config?: Record<string, unknown>;
}

// =============================================================================
// Conversation Types
// =============================================================================

/**
 * Summary information about a conversation.
 */
export interface ConversationSummary {
	/** The destination for this conversation */
	destination: Destination;
	/** Bound agent ID, or null if unbound */
	agentId: AgentSessionId | null;
	/** When the conversation was created */
	createdAt: string;
	/** Last activity timestamp */
	lastActivityAt: string;
}

/**
 * Detailed information about a conversation.
 */
export interface ConversationDetails extends ConversationSummary {
	/** Full binding information */
	binding: ConversationBinding;
}

// =============================================================================
// Config Types
// =============================================================================

/**
 * Daemon configuration (subset safe to expose).
 */
export interface DaemonConfig {
	/** Socket path for IPC */
	socketPath: string;
	/** Storage path for persistence */
	storagePath: string;
	/** Log level */
	logLevel: string;
}

/**
 * Configuration validation result.
 */
export interface ConfigValidationResult {
	/** Whether the configuration is valid */
	valid: boolean;
	/** Validation errors if any */
	errors?: string[];
}

// =============================================================================
// Onboard Types
// =============================================================================

/**
 * Status of the onboard operation.
 */
export interface OnboardStatus {
	/** Path where guidance files will be copied */
	guidancePath: string;
	/** List of template files available to copy */
	templates: string[];
	/** List of files that already exist and would be overwritten */
	existing: string[];
}

/**
 * Result of the onboard execution.
 */
export interface OnboardResult {
	/** Files that were copied */
	copied: string[];
	/** Files that were backed up (as .bak) */
	backedUp: string[];
	/** Files that were skipped (dry-run mode) */
	skipped: string[];
}

// =============================================================================
// Scheduler Types
// =============================================================================

/**
 * Information about a scheduled job.
 */
export interface SchedulerJobInfo {
	/** Job name */
	name: string;
	/** Cron schedule expression */
	schedule: string;
	/** Next scheduled run time (ISO string), or null if not scheduled */
	nextRun: string | null;
}

// =============================================================================
// RPC Method Names
// =============================================================================

/**
 * All RPC method names.
 */
export type RpcMethodName =
	// Daemon lifecycle
	| 'daemon.status'
	| 'daemon.shutdown'
	| 'daemon.ping'
	| 'daemon.reload'
	// Agent methods
	| 'agent.list'
	| 'agent.get'
	| 'agent.spawn'
	| 'agent.continue'
	| 'agent.terminate'
	| 'agent.pause'
	| 'agent.resume'
	| 'agent.send'
	| 'agent.snapshot'
	| 'agent.listCheckpoints'
	// Channel methods
	| 'channel.list'
	| 'channel.get'
	| 'channel.connect'
	| 'channel.disconnect'
	| 'channel.reconnect'
	// Conversation methods
	| 'conversation.list'
	| 'conversation.get'
	| 'conversation.unbind'
	// Subscription methods
	| 'subscribe.agents'
	| 'subscribe.agent.output'
	| 'subscribe.channels'
	| 'subscribe.logs'
	| 'unsubscribe'
	// Configuration methods
	| 'config.get'
	| 'config.validate'
	// Onboard methods
	| 'onboard.status'
	| 'onboard.execute'
	// Scheduler methods
	| 'scheduler.list'
	| 'scheduler.trigger';

// =============================================================================
// RPC Method Parameters
// =============================================================================

/**
 * Parameter types for each RPC method.
 */
export interface RpcMethods {
	// Daemon lifecycle
	'daemon.status': Record<string, never>;
	'daemon.shutdown': {
		graceful?: boolean;
		timeoutMs?: number;
	};
	'daemon.ping': Record<string, never>;
	'daemon.reload': Record<string, never>;

	// Agent methods
	'agent.list': {
		filter?: AgentFilter;
	};
	'agent.get': {
		id: AgentSessionId;
	};
	'agent.spawn': {
		/** Model identifier in format "provider/model-name". If not provided, uses default from preferences. */
		model?: string;
		guidancePath?: string;
		task?: string;
		input?: AgentInput;
		tags?: string[];
		/** Override thinking level for this session */
		thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
	};
	'agent.terminate': {
		id: AgentSessionId;
		reason?: string;
	};
	'agent.pause': {
		id: AgentSessionId;
	};
	'agent.resume': {
		id: AgentSessionId;
	};
	'agent.send': {
		id: AgentSessionId;
		input: AgentInput;
	};
	'agent.snapshot': {
		id: AgentSessionId;
	};
	'agent.continue': {
		/** Session ID to continue from */
		sessionId: AgentSessionId;
		/** New input to send */
		input: AgentInput;
		/** Optional model override in format "provider/model-name" */
		model?: string;
	};
	'agent.listCheckpoints': Record<string, never>;

	// Channel methods
	'channel.list': Record<string, never>;
	'channel.get': {
		id: ChannelId;
	};
	'channel.connect': {
		type: string;
		config: Record<string, unknown>;
	};
	'channel.disconnect': {
		id: ChannelId;
	};
	'channel.reconnect': {
		id: ChannelId;
	};

	// Conversation methods
	'conversation.list': {
		filter?: ConversationFilter;
	};
	'conversation.get': {
		destination: Destination;
	};
	'conversation.unbind': {
		destination: Destination;
	};

	// Subscription methods
	'subscribe.agents': {
		filter?: AgentFilter;
	};
	'subscribe.agent.output': {
		id: AgentSessionId;
	};
	'subscribe.channels': Record<string, never>;
	'subscribe.logs': {
		level?: string;
	};
	unsubscribe: {
		subscriptionId: string;
	};

	// Configuration methods
	'config.get': Record<string, never>;
	'config.validate': {
		config: Record<string, unknown>;
	};

	// Onboard methods
	'onboard.status': Record<string, never>;
	'onboard.execute': {
		/** Create .bak files for overwritten files */
		backup: boolean;
		/** Only report what would be done, don't actually copy */
		dryRun: boolean;
	};

	// Scheduler methods
	'scheduler.list': Record<string, never>;
	'scheduler.trigger': {
		/** Name of the job to trigger */
		job: string;
	};
}

// =============================================================================
// RPC Method Results
// =============================================================================

/**
 * Return types for each RPC method.
 */
export interface RpcMethodResults {
	// Daemon lifecycle
	'daemon.status': DaemonStatus;
	'daemon.shutdown': { ok: true };
	'daemon.ping': { pong: true };
	'daemon.reload': { reloaded: string[] };

	// Agent methods
	'agent.list': AgentSummary[];
	'agent.get': AgentDetails | null;
	'agent.spawn': { id: AgentSessionId };
	'agent.terminate': { ok: true };
	'agent.pause': { ok: true };
	'agent.resume': { ok: true };
	'agent.send': { ok: true };
	'agent.snapshot': AgentSnapshot;
	'agent.continue': { id: AgentSessionId };
	'agent.listCheckpoints': AgentSessionId[];

	// Channel methods
	'channel.list': ChannelSummary[];
	'channel.get': ChannelDetails | null;
	'channel.connect': { ok: true };
	'channel.disconnect': { ok: true };
	'channel.reconnect': { ok: true };

	// Conversation methods
	'conversation.list': ConversationSummary[];
	'conversation.get': ConversationDetails | null;
	'conversation.unbind': { ok: true };

	// Subscription methods
	'subscribe.agents': { subscriptionId: string };
	'subscribe.agent.output': { subscriptionId: string };
	'subscribe.channels': { subscriptionId: string };
	'subscribe.logs': { subscriptionId: string };
	unsubscribe: { ok: true };

	// Configuration methods
	'config.get': DaemonConfig;
	'config.validate': ConfigValidationResult;

	// Onboard methods
	'onboard.status': OnboardStatus;
	'onboard.execute': OnboardResult;

	// Scheduler methods
	'scheduler.list': { jobs: SchedulerJobInfo[] };
	'scheduler.trigger': { triggered: true };
}
