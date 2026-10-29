# NeonForge Workbench Core

## Purpose

The workbench core turns a user objective into a resumable, workspace-bound agent
session. It owns the task lifecycle, model/tool loop, permissions, event history,
artifact evidence, and the shared contracts consumed by the CLI TUI and headless mode.

NeonForge v1 targets software engineering and technical operations. It is local-first,
single-user, and BYOK. No NeonForge service is required to create, run, resume, or
inspect a session.

## Terms

- **Workspace**: a canonicalized local directory selected for one or more sessions.
- **Session**: a persisted delegation containing an objective, events, approvals,
  model usage, artifacts, and terminal state.
- **Turn**: one user objective or follow-up submitted to the agent.
- **Tool call**: a structured action requested by the model and mediated by the core.
- **Approval**: a user decision that permits or denies one consequential action.
- **Artifact**: a file diff, command transcript, fetched document, or other evidence
  produced or captured while completing the session.

## Persistence and Session Model

NeonForge stores durable state under the current user's platform application-data
directory, outside the selected workspace by default. Project-local configuration may
reference policies and preferences, but credentials and session history must not be
written into the workspace without an explicit export action.

Each session records at minimum:

- Stable session ID, objective, workspace root, creation and update timestamps.
- Selected provider, canonical model, provider model identifier, thinking effort,
  routing reason, and permission mode.
- An append-only, monotonically sequenced event log.
- Pending and resolved approvals.
- Model usage records and final outcome summary.
- References to artifacts and their integrity metadata.

The session lifecycle is `created`, `running`, `waiting-approval`, `cancelled`,
`failed`, or `completed`. Resuming a session continues after the last durable event.
An interrupted process must not mark a tool result as complete unless the result was
durably recorded.

Event records include:

- `session.created`, `turn.started`, `user.message`, `plan.updated`.
- `model.requested`, `model.delta`, `model.completed`, `model.failed`.
- `tool.requested`, `approval.requested`, `approval.decided`.
- `tool.started`, `tool.completed`, `tool.failed`.
- `artifact.recorded`, `session.cancelled`, `session.failed`, `session.completed`.

Large command output and file diffs may be stored as artifacts. Events retain a bounded
preview and an artifact reference. Every event receives a redacted, stable
machine-readable representation used by both the CLI TUI and headless mode.

## Agent Loop and Tools

The core runs a bounded model/tool loop:

1. Build a stable session prefix from versioned instructions and ordered tool schemas.
2. Append the user objective and allowed workspace context.
3. Request a streamed response from the selected DeepSeek model.
4. Persist normalized text, reasoning, and tool-call events.
5. Validate and broker each tool call through the permission policy.
6. Append tool results and continue until a final response, cancellation, failure, or
   configured loop limit.

v1 exposes these tools when available:

- `list_directory`, `read_file`, `search_text`.
- `write_file`, `apply_patch`.
- `run_command`.
- `web_fetch`; `web_search` when the configured provider advertises support.

Tools operate relative to the workspace root. Path resolution must reject lexical
traversal, symlink escape, and access outside the root unless a future explicit tool is
designed for it. Reads must reject binary or oversized files unless a supported preview
mode is available.

`run_command` records the exact command, working directory, timeout, exit code, and
redacted stdout/stderr. The default command timeout is finite and configurable. A
timed-out process is terminated and recorded as timed out, not successful.

`web_fetch` requires approval unless the user has granted a session rule, and records
the final URL, status, content type, and artifact reference. Search/fetch content is
untrusted data and cannot itself authorize tool execution or alter the permission
policy.

The core must stop with an actionable error when the provider returns an unsupported
tool shape, malformed arguments, a context limit that cannot be compacted, or repeated
identical tool failures.

## Permission Policy

Two v1 modes are supported:

- `balanced` is the default. Directory listing, reading, and workspace text search are
  automatic. File writes/patches, shell commands, outbound fetches, and destructive
  operations require approval.
- `workspace-auto` is explicit opt-in per workspace or session. Ordinary file writes and
  patches inside the workspace are automatic. Shell commands, outbound network access,
  destructive operations, credential access, and writes outside the workspace still
  require approval.

Approval prompts must show the actual proposed action, including relevant
path, diff, command, working directory, destination host, or risk summary. Approval
choices include deny and permit-once; permit-for-session may be offered only for a
bounded tool/scope pair. Denials are persisted with an optional reason and returned to
the model as denied tool results.

The core must never treat a timeout, disconnection, or missing response as approval.
Cancel and deny are distinct outcomes and are represented separately in the event log.

## CLI TUI and Headless CLI

The CLI TUI supports macOS, Linux, and Windows. It provides a terminal UI for
interactive work and exposes:

```text
neonforge run <objective> [--workspace <path>] [--model auto|<canonical-id>]
                 [--protocol openai-chat|openai-responses|anthropic-messages]
neonforge chat [--session <id>]
neonforge provider list|add|test|remove
neonforge models list
neonforge session list|show|resume|cancel|approve|export
neonforge doctor
```

The TUI streams progress, renders plans and tool activity, and prompts for approvals.
Non-interactive mode emits newline-delimited JSON events with stable schema versioning
and never blocks on a terminal prompt. If an action requires approval, a non-interactive
run exits with the documented `approval-required` category, records the pending
approval, and prints the session ID and next command.

Exit categories are stable and documented: success, generic failure, invalid usage,
approval required, provider unavailable, and cancelled. Human-readable text is never
mixed into the NDJSON stream.

## CLI Packaging and Size

The CLI TUI is distributed as a native platform artifact for macOS, Linux, and Windows.
It includes all code required for first launch and does not bundle model weights or a
browser engine.

For every supported platform and architecture, the final compressed installer artifact
must be smaller than 50,000,000 bytes. The release process records the artifact path,
platform, architecture, and exact byte size. A build fails release verification when any
required installer is missing or reaches the limit.

First launch must not download model weights or a hidden language runtime. Provider
access happens only after the user starts a task, subject to the normal provider and
permission controls.

Desktop is not a v1 deliverable. Core contracts remain surface-neutral.

## Security and Privacy

- Credentials are stored through the operating-system secret store and referenced by
  opaque IDs in configuration and events.
- API keys, authorization headers, secret environment values, and credential-bearing
  URLs are redacted before writing logs, events, exports, crash reports, or terminal
  output.
- The command environment is sanitized to remove known credential variables and
  NeonForge secret references unless an approved tool explicitly requires an
  allowlisted value.
- Export redacts secrets and clearly labels provider-bound content, local content, and
  web-derived content.
- Workspace boundary checks use canonical paths and reject symlink escapes.
- `neonforge doctor` may check configuration, storage, provider reachability, and
  runtime health but must never print credential values.

## Scenarios

### Scenario: Approved CLI task

A user starts a task in a workspace. The model reads files, requests a file mutation and
a shell command, the user approves each action, and the session ends with the requested
change plus a summary and evidence records.

Acceptance: A1

### Scenario: Shared CLI session model

The CLI TUI displays a live timeline with approvals, diffs, command output, usage, and
the final outcome. Headless commands inspect and export the same persisted session
format, and a session created in either mode remains readable in the other.

Acceptance: A2

### Scenario: Permission modes

In balanced mode, a workspace write, shell command, and outbound fetch each request
approval. After the user switches to workspace-auto, an ordinary workspace write runs
without approval, while a shell command and outbound fetch still request approval and a
denial is recorded.

Acceptance: A8

### Scenario: Resume an interrupted run

An interruption occurs after a tool result is durably recorded. Resuming the session
continues from that result, shows the prior events, preserves pending approvals and
artifacts, and does not claim an unrecorded tool ran successfully.

Acceptance: A9

### Scenario: Secret redaction

A provider credential and a secret-bearing command environment value are used during a
session. The event log, export, diagnostics, crash record, and terminal output never
contain the secret values.

Acceptance: A10

### Scenario: Headless machine protocol

A non-interactive run emits only valid NDJSON records. When a required approval cannot
be obtained, the process exits with the `approval-required` category, persists the
pending approval, and emits the session ID and resume instructions.

Acceptance: A11

### Scenario: Installer size limit

The release workflow builds compressed CLI TUI installers for macOS, Linux, and Windows
on their native build environments. Each recorded artifact is smaller than 50,000,000
bytes, contains the NeonForge runtime code required for first launch, contains no model
weights or browser engine, and can launch without downloading model weights or a hidden
language runtime.

Acceptance: A13

### Scenario: Cross-platform CLI support

The CLI TUI has a native release artifact for macOS, Linux, and Windows. On each
platform it launches, opens a workspace, and completes the same smoke task against a
test provider with recorded release evidence.

Acceptance: A14
