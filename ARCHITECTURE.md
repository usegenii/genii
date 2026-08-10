# Genii Architecture

Genii is a local-first runtime for a persistent AI companion. A single long-lived daemon owns agent execution,
conversation routing, messaging connections, scheduled work, and persisted local state. Model providers and messaging
platforms are external services; the authoritative copy of the companion's operating context and continuity is held
on the user's machine.

This document describes the system's conceptual organization and current architectural constraints. It intentionally
avoids implementation and repository structure.

## Architectural shape

Genii separates owner control from conversation traffic while keeping both behind one authoritative local process.

```mermaid
flowchart LR
	subgraph LocalHost["Trusted local host"]
		subgraph Daemon["Genii daemon process"]
			Control["Local control boundary"] <-->|"control and status"| Core["Lifecycle and routing"]
			Channel["Channel boundary"] <-->|"events and intents"| Core
			Core <-->|"session lifecycle"| Sessions["Agent sessions"]
			Scheduler["Scheduler"] -->|"proactive trigger"| Sessions
		end
		Core <-->|"guidance, memory, and checkpoints"| State["Local persisted state"]
		Sessions <-->|"capability calls and results"| Tools["Host tools and resources"]
	end
	Owner["Owner"] <-->|"local IPC"| Control
	Platform["Messaging platform"] <-->|"native protocol"| Channel
	Sessions <-->|"inference"| Provider["Model provider"]
```

The daemon is both the control plane and the conversation plane:

- The **control plane** lets local clients configure and inspect the system, manage channels and sessions, trigger
  scheduled work, and observe status.
- The **conversation plane** receives external events, selects the appropriate session, runs the agent, and returns
  platform-appropriate responses.

Agent sessions are concurrent logical state machines inside the daemon. They are not separate services, containers,
or operating-system processes.

Control-plane observations use connection-owned subscriptions. Agent output and structured daemon logs are retained in
bounded, in-memory journals so a client can replay recent records and then follow new records on the same subscription.
The daemon installs the live subscription before taking the replay snapshot; sequence numbers let clients merge the
intentional overlap without duplicates or a replay-to-live gap. Closing a local IPC connection releases only that
connection's subscriptions. The journals are operational buffers rather than durable state and reset with the daemon.

## Core concepts

| Concept | Architectural meaning |
| --- | --- |
| **Channel** | One configured connection to a messaging platform. It owns platform authentication, ingress filtering, addressing, and presentation behavior. |
| **Destination** | An opaque address within a channel, such as a chat, thread, topic, or direct-message context. Platform-specific addressing does not leak into agent reasoning. |
| **Conversation** | The continuity scope at one channel-specific destination. A persisted binding assigns at most one agent session to that scope, so it is not a global identity for a person. |
| **Agent session** | The stable execution identity and history for reactive or proactive work. A conversation may bind one; a session may finish a turn and later resume. |
| **Guidance** | Owner-authored context defining identity, behavior, task recipes, skills, time context, and proactive-work policy. |
| **Memory** | Owner- and agent-maintained learned or working context that is retained across otherwise independent sessions. |
| **Checkpoint** | A versioned, provider-neutral record of session history and metadata. It also records an active durable tool wait, its completed steps, and any accepted resolution so the exact invocation can replay after restart. |
| **Pulse** | An optional scheduled session for proactive work. It shares normal guidance and capabilities but is independent of any reactive conversation session. |

The current external messaging integration is Telegram. The channel contract is intentionally platform-neutral so
additional integrations can preserve the same routing and session semantics.

## Execution flows

### Reactive conversations

1. A channel authenticates and filters an external update, then converts it into a normalized event with an opaque
   origin destination.
2. The daemon handles in-channel commands directly or converts conversational events into agent input.
3. The destination's conversation binding selects a session.
4. If no session is bound, Genii creates and binds one before execution starts. A live session receives follow-up
   input directly. A completed or post-restart session resumes from its checkpoint. Ordinary input is rejected with
   an explicit response while the bound session has a durable tool wait.
5. The agent combines its history, current guidance, selected model, and available tools to execute the turn.
6. Status, tool activity, streamed output, final responses, and errors become semantic outbound intents. The channel
   decides how those intents appear on its platform.
7. The binding remains after the turn so later messages retain continuity. Starting over explicitly replaces the
   bound session for that destination.

Binding before execution is an important invariant: even the earliest agent output always has a destination.

### Proactive work

When enabled, the scheduler creates a fresh pulse session using the same guidance, model selection, and tools as a
normal session. A pulse can deliver useful output to a named destination or the most recently active destination, or
it can run silently. Selecting the most recent destination affects delivery only; it does not attach the pulse to that
conversation's history. A pulse may also explicitly report that no action is warranted, in which case no message is
sent.

## State and continuity

Continuity is split into layers with different responsibilities:

- **Conversation bindings** preserve where replies belong and which session should handle the next message.
- **Session checkpoints** preserve completed-turn history and session metadata across later turns and daemon restarts.
  At a durable tool wait, they additionally preserve the exact tool call, input, completed steps, request, deadline,
  and accepted resolution so the invocation can replay without a synthetic user turn.
- **Guidance** preserves the owner-authored identity, policies, and reusable capabilities applied to sessions.
- **Memory** preserves learned context and working state across otherwise independent sessions.

Recovery is lazy. On startup, Genii restores persisted routing state but does not eagerly resume every prior session.
New input resumes a completed bound session from its checkpoint. A dormant wait remains dormant until the control
plane inspects or resolves it; inspection does not instantiate the model. If no usable checkpoint exists, the daemon
starts a fresh session and repairs the binding.

Completed turns are checkpointed, and durable-wait transitions add stricter barriers: the wait is persisted before it
is published, an accepted resolution is persisted before it is acknowledged, and the real tool result is persisted
before model execution continues. Checkpoint files and conversation bindings use atomic replacement, and binding
changes are persisted when they occur. Other in-flight model or tool work is not transactional and may be lost after
an abrupt process failure. Delivery and arbitrary post-resume side effects remain at-least-once rather than
exactly-once. These stores favor inspectable, local state over distributed coordination or high availability.

Durable waits are resolved explicitly through the control plane. One tool invocation may be suspended per session;
sequential waits in that invocation are supported. See [Durable suspensions](docs/durable-suspensions.md) for the tool
and RPC contracts.

Configuration is also local and owner-managed. Logical model names separate session policy from provider-specific
identifiers, and secret references keep credentials out of ordinary configuration. Native credential storage is
preferred, with a restricted local file as a fallback. Configuration is read at daemon startup; restarting the daemon
is currently the reliable way to apply changes.

## Boundaries and extension model

Genii isolates change at explicit architectural boundaries:

- **Messaging boundary:** platform adapters translate between native updates and normalized inbound events, then
  interpret semantic outbound intents using platform capabilities.
- **Model boundary:** model adapters translate common session semantics to a configured inference provider. The
  provider-neutral checkpoint format keeps continuity from being inherently tied to one provider.
- **Capability boundary:** tools add actions available to agents; context contributors add ordered guidance; commands
  add owner-facing control behavior; scheduled jobs add autonomous triggers.
- **Persistence boundary:** routing, checkpoints, guidance, memory, and delivery preferences belong to the local Genii
  data domain rather than to a messaging or model provider.

These are substitution boundaries, not network-service boundaries. Extensions normally execute within the daemon's
process and trust domain.

## Trust and reliability model

Genii assumes a single trusted owner on a trusted host. The control plane relies on operating-system access controls
around local IPC rather than application-level authentication. Remote authorization is a channel-edge responsibility,
not a core security boundary. The current Telegram allowlist is permissive unless populated, so it must be configured
deliberately.

Local-first does not mean local-only. The selected model provider receives the conversation, guidance, and tool data
needed for inference, while messaging platforms process the content and addressing needed for delivery. Those external
services remain separate data-governance and trust domains.

Agent capabilities share the daemon user's privileges. In particular, host command execution is not sandboxed: it can
access the filesystem, processes, environment, and network available to the daemon account. Guidance and model policy
are behavioral controls, not a hard security boundary. Anyone allowed to send agent-bound input can potentially
influence those capabilities.

Checkpoints, memories, routing metadata, and logs may contain sensitive conversation or host information and should be
protected as user data. Credentials receive separate handling, but the broader data directory is not an encrypted
vault.

Startup restores routing state before accepting control or channel traffic while leaving suspended models dormant.
Shutdown stops new work first, then scheduling and channel ingress, flushes and detaches waiting sessions immediately,
and drains other active sessions within a limit. Failures are surfaced through structured logs and lightweight
health/status data. Message delivery remains best-effort: there is no durable outbound queue or end-to-end exactly-once
guarantee.
