/**
 * Canonical request and result types for the daemon's JSON RPC boundary.
 * All values in this module describe their serialized wire representation.
 */

import type { Destination } from '@genii/comms/destination/types';
import type { ChannelId, ChannelStatus } from '@genii/comms/types/core';
import type {
	AgentFilter,
	AgentInput,
	AgentResult,
	AgentSessionId,
	AgentSnapshot,
	AgentStatus,
} from '@genii/orchestrator/types/core';

export type RpcLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface DaemonStatus {
	status: 'running' | 'stopping';
	uptimeMs: number;
	agentCount: number;
	channelCount: number;
	version: string;
}

export interface AgentSummary {
	id: AgentSessionId;
	status: AgentStatus;
	tags?: string[];
	createdAt: string;
}

export interface AgentDetails extends AgentSummary {
	guidancePath?: string;
	metadata?: Record<string, unknown>;
	parentId?: AgentSessionId;
}

export interface AgentListFilter extends AgentFilter {
	channelId?: ChannelId;
}

export interface ChannelSummary {
	id: ChannelId;
	type: string;
	status: ChannelStatus;
}

export interface ChannelDetails extends ChannelSummary {
	registeredAt?: string;
	config?: Record<string, unknown>;
}

export interface ConversationFilter {
	channelId?: ChannelId;
	hasAgent?: boolean;
}

export interface ConversationSummary {
	destination: Destination;
	agentId: AgentSessionId | null;
	createdAt: string;
	lastActivityAt: string;
}

export interface ConversationBindingDto {
	destination: Destination;
	agentId: AgentSessionId | null;
	createdAt: string;
	lastActivityAt: string;
}

export interface ConversationDetails extends ConversationSummary {
	binding: ConversationBindingDto;
}

export interface DaemonConfig {
	socketPath: string;
	storagePath: string;
	logLevel: string;
}

export interface ConfigValidationResult {
	valid: boolean;
	errors?: string[];
}

export interface OnboardStatus {
	guidancePath: string;
	templates: string[];
	existing: string[];
}

export interface OnboardResult {
	copied: string[];
	backedUp: string[];
	skipped: string[];
}

export interface SchedulerJobInfo {
	name: string;
	schedule: string;
	nextRun: string | null;
}

/** JSON values accepted by the daemon's RPC transport. */
export type RpcJsonValue = string | number | boolean | null | RpcJsonValue[] | RpcJsonObject;

export interface RpcJsonObject {
	[key: string]: RpcJsonValue;
}

export interface RpcToolProgress {
	percentage?: number;
	message?: string;
	data?: RpcJsonObject;
}

export type RpcSuspensionRequest =
	| { type: 'user_input'; prompt: string; schema?: RpcJsonValue; timeout?: number }
	| { type: 'approval'; action: string; description?: string; details?: RpcJsonObject; timeout?: number }
	| { type: 'event'; eventName: string; timeout?: number }
	| { type: 'sleep'; durationMs: number; wakeAt: number };

export interface RpcPendingRequestInfo {
	toolCallId: string;
	toolName: string;
	type: 'user_input' | 'approval' | 'event' | 'sleep';
	request: RpcSuspensionRequest;
	suspendedAt: number;
}

/** JSON-safe representation of an orchestrator agent event on the RPC wire. */
export type RpcAgentEvent =
	| { type: 'status'; status: AgentStatus; previousStatus?: AgentStatus; timestamp: number }
	| { type: 'output'; text: string; final: boolean; timestamp: number }
	| { type: 'thought'; content: string; timestamp: number }
	| { type: 'tool_start'; toolCallId: string; toolName: string; input: RpcJsonValue; timestamp: number }
	| {
			type: 'tool_progress';
			toolCallId: string;
			toolName: string;
			progress: RpcToolProgress;
			timestamp: number;
	  }
	| {
			type: 'tool_end';
			toolCallId: string;
			toolName: string;
			output?: RpcJsonValue;
			error?: string;
			durationMs: number;
			timestamp: number;
	  }
	| { type: 'suspended'; pendingRequests: RpcPendingRequestInfo[]; timestamp: number }
	| { type: 'memory_updated'; path: string; operation: 'write' | 'delete'; timestamp: number }
	| { type: 'error'; error: string; fatal: boolean; stack?: string; timestamp: number }
	| { type: 'done'; result: AgentResult; timestamp: number };

/** A sequenced agent event retained for replay. */
export interface AgentOutputRecord {
	sequence: number;
	agentId: AgentSessionId;
	event: RpcAgentEvent;
}

/** A normalized daemon log record retained for replay. */
export interface LogEntry {
	sequence: number;
	timestamp: number;
	level: RpcLogLevel;
	component?: string;
	message: string;
	data?: RpcJsonObject;
}

export type SubscriptionMethodName =
	| 'subscribe.agents'
	| 'subscribe.agent.output'
	| 'subscribe.channels'
	| 'subscribe.logs';

export type RpcMethodName =
	| 'daemon.status'
	| 'daemon.shutdown'
	| 'daemon.ping'
	| 'daemon.reload'
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
	| 'channel.list'
	| 'channel.get'
	| 'channel.connect'
	| 'channel.disconnect'
	| 'channel.reconnect'
	| 'conversation.list'
	| 'conversation.get'
	| 'conversation.unbind'
	| SubscriptionMethodName
	| 'unsubscribe'
	| 'config.get'
	| 'config.validate'
	| 'onboard.status'
	| 'onboard.execute'
	| 'scheduler.list'
	| 'scheduler.trigger';

export interface RpcMethods {
	'daemon.status': Record<string, never>;
	'daemon.shutdown': { graceful?: boolean; timeoutMs?: number };
	'daemon.ping': Record<string, never>;
	'daemon.reload': Record<string, never>;
	'agent.list': { filter?: AgentListFilter };
	'agent.get': { id: AgentSessionId };
	'agent.spawn': {
		model?: string;
		guidancePath?: string;
		task?: string;
		input?: AgentInput;
		tags?: string[];
		thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
		bind?: Destination;
	};
	'agent.terminate': { id: AgentSessionId; reason?: string };
	'agent.pause': { id: AgentSessionId };
	'agent.resume': { id: AgentSessionId };
	'agent.send': { id: AgentSessionId; input: AgentInput };
	'agent.snapshot': { id: AgentSessionId };
	'agent.continue': { sessionId: AgentSessionId; input: AgentInput; model?: string };
	'agent.listCheckpoints': Record<string, never>;
	'channel.list': Record<string, never>;
	'channel.get': { id: ChannelId };
	'channel.connect': { type: string; config: Record<string, unknown> };
	'channel.disconnect': { id: ChannelId };
	'channel.reconnect': { id: ChannelId };
	'conversation.list': { filter?: ConversationFilter };
	'conversation.get': { destination: Destination };
	'conversation.unbind': { destination: Destination };
	'subscribe.agents': { filter?: AgentFilter };
	'subscribe.agent.output': { id: AgentSessionId };
	'subscribe.channels': Record<string, never>;
	'subscribe.logs': {
		level?: RpcLogLevel;
		component?: string;
		since?: string | number;
		limit?: number;
		follow?: boolean;
	};
	unsubscribe: { subscriptionId: string };
	'config.get': Record<string, never>;
	'config.validate': { config: Record<string, unknown> };
	'onboard.status': Record<string, never>;
	'onboard.execute': { backup: boolean; skip: boolean; dryRun: boolean };
	'scheduler.list': Record<string, never>;
	'scheduler.trigger': { job: string };
}

export interface RpcMethodResults {
	'daemon.status': DaemonStatus;
	'daemon.shutdown': { ok: true };
	'daemon.ping': { pong: true };
	'daemon.reload': { reloaded: string[] };
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
	'channel.list': ChannelSummary[];
	'channel.get': ChannelDetails | null;
	'channel.connect': { ok: true };
	'channel.disconnect': { ok: true };
	'channel.reconnect': { ok: true };
	'conversation.list': ConversationSummary[];
	'conversation.get': ConversationDetails | null;
	'conversation.unbind': { ok: true };
	'subscribe.agents': { subscriptionId: string };
	'subscribe.agent.output': { subscriptionId: string; events: AgentOutputRecord[] };
	'subscribe.channels': { subscriptionId: string };
	'subscribe.logs': { subscriptionId: string; entries: LogEntry[] };
	unsubscribe: { ok: true };
	'config.get': DaemonConfig;
	'config.validate': ConfigValidationResult;
	'onboard.status': OnboardStatus;
	'onboard.execute': OnboardResult;
	'scheduler.list': { jobs: SchedulerJobInfo[] };
	'scheduler.trigger': { triggered: true };
}
