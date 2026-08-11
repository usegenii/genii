/** Typed daemon notifications sent outside request/response RPC messages. */

import type { AgentOutputRecord, LogEntry } from './methods.js';

export interface RpcNotificationParams {
	'agent.output': AgentOutputRecord & { subscriptionId: string };
	'logs.entry': { subscriptionId: string; entry: LogEntry };
}

export type RpcNotificationMethodName = keyof RpcNotificationParams;

export type RpcNotification = {
	[M in RpcNotificationMethodName]: {
		readonly method: M;
		readonly params: RpcNotificationParams[M];
	};
}[RpcNotificationMethodName];
