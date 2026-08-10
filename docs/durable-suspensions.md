# Durable suspensions

Genii tools can stop at a durable wait and later continue the same invocation even if the model process disappears.
The wait, its accepted resolution, and the conversation binding survive daemon restarts. Waits are inspected and
resolved explicitly through the coordinator or daemon RPC API.

## Tool-author contract

`ToolContext.step` exposes memoized steps and four durable wait operations:

- `waitForUserInput(request)` waits for a typed value.
- `waitForApproval(request)` waits for an approval decision and optional reason.
- `waitForEvent(eventName, options)` waits for an opaque external payload.
- `sleep(ms)` records a wake deadline and waits for an explicit sleep resolution.

Keep any side effect that must not repeat across replay inside a stable `step.run()` call:

```ts
const prepared = await context.step.run('prepare-build', async () => {
	return createBuild(input);
});

const result = await context.step.waitForEvent<BuildResult>('build.finished', {
	timeout: 30 * 60 * 1000,
});

return { status: 'success', output: { prepared, result } };
```

`step.run()` IDs must be stable and unique within the tool invocation. When the wait resolves, Genii replays the tool
with the original tool-call ID and input. Completed steps return their memoized values, so `createBuild()` above
executes once. Arbitrary side effects outside durable steps remain at-least-once and must be idempotent.

Cancellation and timeout resolutions throw `SuspensionCancelledError` and `SuspensionTimeoutError` inside the
replayed tool invocation. A rejected approval is a normal value with `approved: false`. Event and user-input payloads
preserve values such as `false` and `null`, while a completed sleep resumes with `void`.

## Lifecycle and durability

One active suspended tool invocation is supported per session. Sequential waits within that invocation are
supported; concurrent suspensions are rejected.

The durable lifecycle is:

1. A tool reaches a wait. Genii records its stable suspension ID, exact step and tool-call IDs, input, completed
   steps, request, suspension time, and absolute deadline.
2. The enriched checkpoint is atomically persisted before Genii publishes `waiting` or `suspended`.
3. A caller inspects the wait without instantiating the model.
4. Genii validates and persists an accepted typed resolution before acknowledging it.
5. Warm and dormant sessions use the same replay path. The tool resumes at the exact wait, produces one real tool
   result, and Pi continues without a synthetic user message.
6. The suspension state is cleared only after successful tool completion.

If checkpoint persistence fails, execution fails closed with a visible fatal error and retains recoverable state for
retry. Repeating an identical accepted resolution is idempotent. Conflicting, stale, malformed, or wrongly typed
resolutions are rejected.

Checkpoints are versioned. Existing unversioned completed checkpoints remain readable for ordinary
`Coordinator.continue()` calls. Waiting sessions are flushed and detached immediately during shutdown rather than
being terminated or held for the graceful-shutdown timeout.

A configured snapshot store is required for durable waits. Without one, reaching a suspension fails closed because
Genii cannot publish a wait it has not durably recorded.

## Coordinator API

The orchestrator exposes three suspension-specific operations:

```ts
const pending = await coordinator.getPendingRequests(sessionId);

const restored = await coordinator.restoreSuspended(sessionId, adapter, { tools });

const handle = await coordinator.resolveSuspensions(
	sessionId,
	[{ suspensionId: pending[0].suspensionId, type: 'event', payload: buildResult }],
	adapter,
	{ tools },
);
```

- `getPendingRequests()` reads dormant checkpoint state without restoring a model.
- `restoreSuspended()` restores the exact suspended invocation without adding user input.
- `resolveSuspensions()` accepts durable resolutions and starts or wakes replay.

`Coordinator.continue()` remains the path for a completed session plus a new user turn. `agent.resume` remains
exclusively for execution paused through the pause API; neither operation resolves a tool wait.

## Daemon RPC API

The daemon uses newline-delimited request objects with an `id`, `method`, and `params`. Inspect a live or dormant
session with `agent.pendingRequests`:

```json
{
	"id": "req-1",
	"method": "agent.pendingRequests",
	"params": { "sessionId": "agent-session-id" }
}
```

Each pending request includes its stable `suspensionId`, `toolCallId`, `toolName`, exact `stepId`, request data,
`suspendedAt`, optional absolute `deadline`, and `waiting` or `resolved` status. Inspection does not instantiate the
saved model.

Resolve it with `agent.resolveSuspensions`:

```json
{
	"id": "req-2",
	"method": "agent.resolveSuspensions",
	"params": {
		"sessionId": "agent-session-id",
		"resolutions": [
			{
				"suspensionId": "opaque-id-from-pending-request",
				"type": "event",
				"payload": { "conclusion": "success" }
			}
		]
	}
}
```

The TypeScript daemon client exposes the same operations as `getPendingRequests(sessionId)` and
`resolveSuspensions(sessionId, resolutions)`.

Treat `suspensionId` as opaque and copy it unchanged from the pending request; callers must not construct it.

Resolution variants are:

| Waiting request | Resolution |
| --- | --- |
| User input | `{ suspensionId, type: 'user_input', value }` |
| Approval | `{ suspensionId, type: 'approval', approved, reason? }` |
| Event | `{ suspensionId, type: 'event', payload }` |
| Sleep | `{ suspensionId, type: 'sleep' }` |
| Any request | `{ suspensionId, type: 'cancel', reason? }` |
| Any request | `{ suspensionId, type: 'timeout' }` |

The daemon restores dormant sessions with the provider, model, and thinking level stored in the checkpoint. If it
stops after accepting a resolution but before replay completes, resend the identical resolution after restart.

## Conversation behavior

Conversation bindings are persisted atomically, so output from a restored session returns to its original
destination. Ordinary chat input is not inserted into a waiting session and does not replace it. Instead, the sender
receives:

> This conversation is waiting for a pending tool request. Resolve or cancel that request before sending another
> message.

The daemon client or RPC API is the operator interface for inspecting and resolving waits.
