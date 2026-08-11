# Durable suspensions

Genii tools can stop at a durable wait and later continue the same invocation even if the model process disappears.
Parallel calls in one assistant tool-call batch retain independent durable state, so one call can wait while its
siblings run or complete. Waits, accepted resolutions, completed sibling results, and the conversation binding survive
daemon restarts. Waits are inspected and resolved explicitly through the coordinator or daemon RPC API.

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
with the original tool-call ID and input. Completed steps belong to that call only and return their memoized values,
so `createBuild()` above executes once even when sibling calls overlap. Arbitrary side effects outside durable steps
remain at-least-once and must be idempotent.

Cancellation and timeout resolutions throw `SuspensionCancelledError` and `SuspensionTimeoutError` inside the
replayed tool invocation. A rejected approval is a normal value with `approved: false`. Event and user-input payloads
preserve values such as `false` and `null`, while a completed sleep resumes with `void`.

## Lifecycle and durability

Each call is tracked under the stable tool-call identity assigned in the assistant message. A suspension has a
separate opaque identity for the exact call and step, so two calls can wait concurrently and can be resolved in either
order without sharing input, completed steps, or resolution data. Sequential waits within one invocation are also
supported.

The durable lifecycle is:

1. A registered tool wrapper starts and establishes runtime ownership of the call's independent execution state and
   assistant source position. That state is not yet recoverable.
2. A tool reaches a wait. Genii records its stable suspension ID, exact step and tool-call IDs, input, completed
   steps, request, suspension time, and absolute deadline.
3. The enriched checkpoint is atomically persisted before Genii publishes `waiting` or `suspended`. This first
   committed wait moves the whole active batch into the recoverable `batch_pending` phase. The wrapper parks at that
   wait, while sibling calls continue until they complete or reach their own waits.
4. A caller inspects one or more waits without instantiating the model.
5. Genii validates and persists each accepted typed resolution before acknowledging it. Resolutions can target one
   call or several calls and need not follow assistant source order.
6. Warm and dormant sessions use the same per-call replay path. Each tool resumes at its exact wait with its own input
   and memoized steps; siblings that already completed reuse their saved results.
7. The model runtime's batch barrier holds the next inference step until every call has a result. Genii then persists
   those results in the assistant message's source order. The completed per-call records remain in that checkpoint as
   an explicit continuation-pending phase until a later checkpoint records the subsequent model turn; the live
   runtime may then clear the batch and allow one model continuation for that recovery attempt.
8. If that recovered continuation reaches another durable wait, its committed wait replaces the completed-batch
   marker. Recovery returns the warm, fully parked handle instead of waiting for the new suspension to resolve.

Tool lifecycle mutations and checkpoint writes are serialized per session. Parallel completion order therefore
cannot let one call overwrite another or allow an older checkpoint to replace newer state. Result presentation and
recovery order follow assistant source order, not wall-clock completion order.

The persisted phase names make both deferred boundaries explicit. `batch_pending` means a durable tool batch still
has unfinished calls, whether or not one currently needs a resolution. `continuation_pending` means every result is
committed in source order and exactly one subsequent model continuation remains before new user input can be accepted.
Completed turns have no recovery phase.

If checkpoint persistence fails, execution fails closed with a visible fatal error and retains recoverable state for
retry. Repeating an identical accepted resolution is idempotent. Conflicting, stale, malformed, or wrongly typed
resolutions are rejected.

Checkpoints are versioned. Existing unversioned completed checkpoints remain readable for ordinary
`Coordinator.continue()` calls. A session reports `waiting` only when every unfinished call in its active batch is
parked; a batch with a waiting call and an active sibling remains `running`. During graceful shutdown, already-active
siblings may finish or park after new coordinator work is closed. Fully parked sessions are then flushed and detached
without termination, and their flushes share the configured bounded persistence drain with other accepted checkpoint
work.

A configured snapshot store is required for durable waits. Without one, reaching a suspension fails closed because
Genii cannot publish a wait it has not durably recorded.

### Durability phase boundary

Per-call runtime ownership begins when a call enters a registered Genii tool wrapper. Calls rejected earlier by
provider or model-runtime preflight, such as an unknown tool or invalid arguments, never enter the wrapper replay
model. Pi nevertheless announces every source call and its finalized preflight result. If a sibling later commits the
batch's first durable wait, Genii retains those already-finalized result artifacts so recovery can reconstruct the
complete result batch in source order. Recoverable durability begins at that first committed wait; before it, the
records and preflight artifacts remain runtime-only and can be lost after a process failure.

Wrapper entry does not make arbitrary tool code transactional. A process failure can replay work performed between
durability barriers, including external effects performed directly by the tool. Put every side effect that must not
repeat in a stable `step.run()` operation, and make any remaining external operation idempotent. Concurrent waits are
durable once the first wait checkpoint commits; pre-wrapper work, pre-wait sibling work, and later work between
barriers are the intentionally excluded phases.

Once every durable call has a result, the saved completed-call records are also an explicit recovery boundary: they
mean the batch is committed and its single model continuation is still pending. A crash after the provider accepts
that continuation but before the following checkpoint can repeat the model request; provider inference remains
at-least-once across that narrow external boundary.

## Coordinator API

The orchestrator exposes four durable-batch operations:

```ts
const pending = await coordinator.getPendingRequests(sessionId);

const restored = await coordinator.restoreSuspended(sessionId, adapter, { tools });

const resumed = await coordinator.resumeContinuation(sessionId, adapter, { tools });

const handle = await coordinator.resolveSuspensions(
	sessionId,
	[{ suspensionId: pending[0].suspensionId, type: 'event', payload: buildResult }],
	adapter,
	{ tools },
);
```

- `getPendingRequests()` reads dormant checkpoint state without restoring a model.
- `restoreSuspended()` restores the session's exact suspended batch without adding user input.
- `resumeContinuation()` consumes a `batch_pending` checkpoint with no still-waiting suspension or an explicit
  `continuation_pending` checkpoint, finishes the batch and its model continuation without adding user input, and
  returns after either persisting a completed turn or committing a new fully parked wait.
- `resolveSuspensions()` accepts one or more durable resolutions and starts or wakes per-call replay. Resolution array
  order does not determine result order.

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

Cancellation is targeted: cancelling one suspension resumes only that invocation with a cancellation error while its
siblings continue. Aborting the agent session is the separate whole-batch operation and stops every outstanding call.

The daemon restores dormant sessions with the provider, model, and thinking level stored in the checkpoint. A
`batch_pending` checkpoint reuses saved sibling results and replays calls whose resolutions are already accepted;
unresolved waits remain dormant until the control plane resolves them. After every call finishes, Genii issues one
model continuation per successful recovery attempt with results assembled in assistant source order. If it stops
after accepting a resolution but before replay completes, the persisted resolution is replayed automatically on the
next routed recovery attempt; resending the identical resolution is also idempotent. A committed
continuation-pending batch needs no new resolution: conversation routing finishes that continuation first, persists
it, and only then processes the newly arrived input as a separate turn. If recovery suspends again, the new wait stays
bound and must be resolved before a later turn; the input that triggered recovery is not inserted into history. A
provider or model recovery failure preserves the marker and conversation binding for another attempt. Explicit
whole-session cancellation or termination instead persists cleared terminal state and removes the marker; shutdown
waits for accepted checkpoint work within its configured bound.

## Conversation behavior

Conversation bindings are persisted atomically, so output from a restored session returns to its original
destination. Inbound work is serialized per destination, so simultaneous input cannot overlap restart recovery or
fork one conversation into multiple session continuations. Ordinary chat input is not inserted into a waiting
session and does not replace it. Instead, the sender receives:

> This conversation is waiting for a pending tool request. Resolve or cancel that request before sending another
> message.

The daemon client or RPC API is the operator interface for inspecting and resolving waits.
