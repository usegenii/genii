import type {
	AgentOutputRecord,
	RpcAgentEvent,
	RpcJsonObject,
	RpcJsonValue,
	RpcPendingRequestInfo,
	RpcSuspensionRequest,
} from '@genii/lib/rpc/methods';
import type { AgentEvent, PendingRequestInfo, SuspensionRequestData } from '@genii/orchestrator/events/types';
import type { AgentSessionId } from '@genii/orchestrator/types/core';

const DEFAULT_AGENT_EVENT_CAPACITY = 1_000;
const MAX_RPC_JSON_DEPTH = 50;

function toRpcJsonValue(value: unknown, seen = new WeakSet<object>(), depth = 0): RpcJsonValue {
	if (depth >= MAX_RPC_JSON_DEPTH) {
		return '[MaxDepth]';
	}

	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'bigint') {
		return value.toString();
	}
	if (typeof value !== 'object') {
		return null;
	}

	try {
		if (value instanceof Date) {
			return Number.isNaN(value.getTime()) ? null : value.toISOString();
		}
		if (value instanceof Error) {
			return {
				name: value.name,
				message: value.message,
				...(value.stack ? { stack: value.stack } : {}),
			};
		}
		if (seen.has(value)) {
			return '[Circular]';
		}
		seen.add(value);

		if (Array.isArray(value)) {
			return value.map((item) => toRpcJsonValue(item, seen, depth + 1));
		}

		const toJSON = Reflect.get(value, 'toJSON') as unknown;
		if (typeof toJSON === 'function') {
			return toRpcJsonValue(Reflect.apply(toJSON, value, []), seen, depth + 1);
		}

		const result: RpcJsonObject = {};
		for (const key of Object.keys(value)) {
			try {
				result[key] = toRpcJsonValue(Reflect.get(value, key), seen, depth + 1);
			} catch {
				result[key] = '[Unserializable]';
			}
		}
		return result;
	} catch {
		return '[Unserializable]';
	}
}

function toRpcJsonObject(value: Record<string, unknown>): RpcJsonObject {
	const normalized = toRpcJsonValue(value);
	return typeof normalized === 'object' && normalized !== null && !Array.isArray(normalized)
		? normalized
		: { value: normalized };
}

function toRpcSuspensionRequest(request: SuspensionRequestData): RpcSuspensionRequest {
	switch (request.type) {
		case 'user_input':
			return {
				type: request.type,
				prompt: request.prompt,
				...(request.schema !== undefined ? { schema: toRpcJsonValue(request.schema) } : {}),
				...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
			};
		case 'approval':
			return {
				type: request.type,
				action: request.action,
				...(request.description !== undefined ? { description: request.description } : {}),
				...(request.details !== undefined ? { details: toRpcJsonObject(request.details) } : {}),
				...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
			};
		case 'event':
			return {
				type: request.type,
				eventName: request.eventName,
				...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
			};
		case 'sleep':
			return { type: request.type, durationMs: request.durationMs, wakeAt: request.wakeAt };
	}
}

export function toRpcPendingRequestInfo(request: PendingRequestInfo): RpcPendingRequestInfo {
	return {
		suspensionId: request.suspensionId,
		toolCallId: request.toolCallId,
		toolName: request.toolName,
		stepId: request.stepId,
		type: request.type,
		request: toRpcSuspensionRequest(request.request),
		suspendedAt: request.suspendedAt,
		...(request.deadline !== undefined ? { deadline: request.deadline } : {}),
		status: request.status,
	};
}

function toRpcAgentEvent(event: AgentEvent): RpcAgentEvent {
	switch (event.type) {
		case 'status':
			return {
				type: event.type,
				status: event.status,
				...(event.previousStatus !== undefined ? { previousStatus: event.previousStatus } : {}),
				timestamp: event.timestamp,
			};
		case 'output':
			return { type: event.type, text: event.text, final: event.final, timestamp: event.timestamp };
		case 'thought':
			return { type: event.type, content: event.content, timestamp: event.timestamp };
		case 'tool_start':
			return {
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: toRpcJsonValue(event.input),
				timestamp: event.timestamp,
			};
		case 'tool_progress':
			return {
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				progress: {
					...(event.progress.percentage !== undefined ? { percentage: event.progress.percentage } : {}),
					...(event.progress.message !== undefined ? { message: event.progress.message } : {}),
					...(event.progress.data !== undefined ? { data: toRpcJsonObject(event.progress.data) } : {}),
				},
				timestamp: event.timestamp,
			};
		case 'tool_end':
			return {
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				...(event.output !== undefined ? { output: toRpcJsonValue(event.output) } : {}),
				...(event.error !== undefined ? { error: event.error } : {}),
				durationMs: event.durationMs,
				timestamp: event.timestamp,
			};
		case 'suspended':
			return {
				type: event.type,
				pendingRequests: event.pendingRequests.map(toRpcPendingRequestInfo),
				timestamp: event.timestamp,
			};
		case 'memory_updated':
			return {
				type: event.type,
				path: event.path,
				operation: event.operation,
				timestamp: event.timestamp,
			};
		case 'error':
			return {
				type: event.type,
				error: event.error,
				fatal: event.fatal,
				...(event.stack !== undefined ? { stack: event.stack } : {}),
				timestamp: event.timestamp,
			};
		case 'done':
			return {
				type: event.type,
				result: {
					status: event.result.status,
					...(event.result.output !== undefined ? { output: event.result.output } : {}),
					...(event.result.error !== undefined ? { error: event.result.error } : {}),
					metrics: {
						durationMs: event.result.metrics.durationMs,
						turns: event.result.metrics.turns,
						...(event.result.metrics.tokensUsed !== undefined
							? {
									tokensUsed: {
										input: event.result.metrics.tokensUsed.input,
										output: event.result.metrics.tokensUsed.output,
										total: event.result.metrics.tokensUsed.total,
									},
								}
							: {}),
						toolCalls: event.result.metrics.toolCalls,
					},
				},
				timestamp: event.timestamp,
			};
	}
}

export class AgentEventJournal {
	private readonly _capacityPerAgent: number;
	private readonly _eventsByAgent = new Map<AgentSessionId, AgentOutputRecord[]>();
	private _nextSequence = 1;

	constructor(capacityPerAgent = DEFAULT_AGENT_EVENT_CAPACITY) {
		if (!Number.isInteger(capacityPerAgent) || capacityPerAgent <= 0) {
			throw new Error('Agent event capacity must be a positive integer');
		}
		this._capacityPerAgent = capacityPerAgent;
	}

	append(agentId: AgentSessionId, event: AgentEvent): AgentOutputRecord {
		const record: AgentOutputRecord = {
			sequence: this._nextSequence++,
			agentId,
			event: toRpcAgentEvent(event),
		};
		const events = this._eventsByAgent.get(agentId) ?? [];
		events.push(record);
		if (events.length > this._capacityPerAgent) {
			events.splice(0, events.length - this._capacityPerAgent);
		}
		this._eventsByAgent.set(agentId, events);
		return record;
	}

	recent(agentId: AgentSessionId): AgentOutputRecord[] {
		return [...(this._eventsByAgent.get(agentId) ?? [])];
	}
}

export function createAgentEventJournal(capacityPerAgent?: number): AgentEventJournal {
	return new AgentEventJournal(capacityPerAgent);
}
