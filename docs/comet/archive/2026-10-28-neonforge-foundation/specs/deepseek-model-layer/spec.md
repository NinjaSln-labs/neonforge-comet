# DeepSeek Model Layer

## Purpose

The model layer exposes DeepSeek-family models through interchangeable providers while
preserving DeepSeek-specific behavior. It is the only path through which NeonForge may
issue model requests.

The layer has two independent concepts:

- **Canonical model identity** determines whether the model is allowed and which
  capabilities NeonForge may use.
- **Provider model identifier** is the vendor-specific string sent over the wire.

A provider model identifier must identify a DeepSeek-family model unambiguously.
Provider prefixes and vendor-specific naming are allowed and do not need to match a
canonical alias exactly. Provider names, discovery output, and arbitrary identifiers
cannot create a new model family or bypass the allowlist.

## Allowed Model Registry

The v1 registry includes at least the following canonical models:

| Canonical ID | Model version | Thinking | Tools | Vision | Context | Max output |
| --- | --- | --- | --- | --- | --- | --- |
| `deepseek-flash` | DeepSeek-V4.1-Flash-1017 | yes | yes | yes | 1M tokens | 384K tokens |

Known aliases are normalized to their canonical ID:

- `deepseek-v4-flash` -> `deepseek-flash`.
- `deepseek-v4-flash-vision-exp` -> `deepseek-flash`.
- `deepseek-v4-pro` -> `deepseek-flash`.

The registry is versioned with the application. New canonical models require a registry
update; users cannot add non-DeepSeek families. A recognized DeepSeek-family provider ID
that is not a named alias uses the default canonical model metadata and preserves the
provider ID on the wire. The registry records family, canonical ID, version,
context/output limits, thinking modes, tool support, JSON support, vision support, and
known aliases.

## Supported Protocol Adapters

Every provider selects one of these mainstream API protocols:

- `openai-chat`: OpenAI Chat Completions, including the official DeepSeek endpoint.
- `openai-responses`: OpenAI Responses API.
- `anthropic-messages`: Anthropic Messages API.

All adapters implement one normalized contract for streaming text, reasoning content,
tool calls and results, usage, cancellation, timeouts, and provider errors. Protocol
translation must preserve DeepSeek-specific thinking and reasoning continuity where the
protocol exposes those fields. If a protocol cannot express a required capability, the
adapter reports an unsupported-capability error instead of silently dropping it.

The DeepSeek-only model policy is enforced before protocol dispatch, so changing the
protocol cannot bypass the registry. Each adapter has a conformance suite using a
controlled server fixture; at least one configured real DeepSeek-serving provider path
is exercised for every protocol in release verification.

## Provider Configuration

The official DeepSeek endpoint is built in:

- OpenAI Chat Completions base URL: `https://api.deepseek.com`.
- Protocol: OpenAI-compatible Chat Completions.
- Authentication: bearer API key stored by opaque secret reference.

Additional providers follow the common agent-CLI integration pattern and require only:

- Base URL.
- API key.
- Model name.
- Protocol.

Users may provide these through `--base-url`, `--api-key`, `--model`, and `--protocol`
flags, through `NEONFORGE_BASE_URL`, `NEONFORGE_API_KEY`, `NEONFORGE_MODEL`, and
`NEONFORGE_PROTOCOL`, or through the common OpenAI-compatible `OPENAI_BASE_URL`,
`OPENAI_API_KEY`, and `OPENAI_MODEL` variables. NeonForge-specific values take
precedence over `OPENAI_*` values.

The protocol defaults to `openai-chat` for backward-compatible agent-CLI setup and is
selected explicitly with `--protocol` or the provider configuration.

Provider configuration also supports a stable provider ID, HTTPS base URL (loopback HTTP
may be allowed for local gateways), non-secret custom headers, and timeout/proxy
settings. No provider discovery API is required, but the model identifier must identify
a DeepSeek-family model.

The configuration validator rejects credentials embedded in URLs, non-HTTPS remote
endpoints, empty model names, unsupported protocols, non-DeepSeek model identifiers, and
canonical IDs absent from the registry.

`neonforge provider test` validates configuration and credential presence before any
model request. It may use `/models` when available but does not require it; otherwise it
performs a minimal configured-model probe. The test reports authentication, endpoint, model
resolution, and capability results separately.

## Request Normalization

The layer converts its normalized request/response contract to the selected protocol
adapter:

- Ordered message history with stable system prefix.
- Tool schemas with deterministic ordering.
- Streaming text, reasoning, and tool-call deltas.
- Thinking enablement and reasoning effort mapped to the protocol-specific fields.

Unsupported parameters are omitted rather than sent with misleading values, or rejected
with an unsupported-capability error when omitting them would change the requested
behavior. For thinking requests, temperature, presence penalty, and frequency penalty
are not exposed as effective controls. Capability-specific UI/CLI settings are hidden or
disabled when the canonical model does not support them.

The normalized response retains:

- Final content and finish reason.
- Exact `reasoning_content` when present.
- Tool calls and their IDs.
- Usage object, including cache hit/miss and output-token fields when provided.
- Provider request ID, model identifier, and latency.

## Reasoning Continuity

When a request contains tools, every subsequent request in that task must include the
complete assistant message history with its `reasoning_content`, including turns where
the model did not call a tool. Dropping reasoning content in this mode is a protocol
error.

When no tools are present, prior reasoning content may be omitted from subsequent model
context. The runtime still records the original provider response as a bounded local
event unless it is redacted from an export.

Reasoning effort is selected per task and shown in the session summary. A provider that
cannot preserve and return reasoning content for a tool-enabled canonical model fails
the compatibility test and is not used for that mode.

## Prompt and Cache Strategy

The model layer builds a cache-friendly prompt:

- The versioned system instructions, tool definitions, and ordering are stable for the
  session and placed at the beginning.
- Session history is append-only between compactions.
- Volatile timestamps, random IDs, and changing UI state are excluded from the static
  prefix.
- Workspace snapshots are inserted as delimited, versioned content rather than
  interleaved into the instructions.
- A compaction creates a new prefix generation and emits an event explaining why the
  cache prefix changed.

DeepSeek context caching is automatic; NeonForge does not claim to force a hit. It
reports provider usage fields such as cache-hit tokens, cache-miss tokens, input tokens,
output tokens, and reasoning tokens when available.

## Model Routing

The route is selected at task creation and does not silently change mid-run. Supported
modes:

- `auto` is the default.
- An explicit canonical model ID overrides auto routing.

Auto selection resolves to an active, allowed DeepSeek model. The v1 baseline is
`deepseek-flash`; the `deepseek-v4-pro` compatibility alias resolves to it. When
multiple active models are registered, auto selection may classify a task as complex
and choose the stronger active model, but it must never change model mid-run. The
session event records the selected model, route reason, alias resolution, and whether it
came from auto or override.

If the selected model lacks a required capability, such as vision for an image-bearing
task, the core fails before the request with a capability explanation and the nearest
allowed alternative; it does not silently substitute a non-DeepSeek model.

## Usage, Cost, and Errors

Every completed model request records:

- Provider ID and provider model identifier.
- Canonical model ID and model version.
- Start/end timestamps and latency.
- Input, output, cache-hit, cache-miss, and reasoning token counts when reported.
- Provider request ID when reported.
- Estimated cost only when a registry price basis is available; otherwise cost is
  `unknown`, not zero.

Errors are classified as configuration, authentication, rate limit, quota, context
limit, unsupported capability, malformed response, transport, timeout, or provider
error. Errors are actionable and redact secrets. Invalid configuration, credential
absence, or model resolution failure is rejected locally before a model request.

## Scenarios

### Scenario: Official and third-party providers

A user configures the official DeepSeek endpoint and a compatible third-party endpoint
with a base URL, API key, DeepSeek-family model identifier (including a vendor-prefixed
name), and protocol, then completes a task through each. The session shows the provider
model identifier, protocol, and canonical capability identity.

Acceptance: A3

### Scenario: Reject a non-DeepSeek model

A provider returns a non-DeepSeek model, or the user supplies a non-DeepSeek model
identifier. NeonForge rejects the configuration before sending a model request and
reports the failed policy check in the CLI.

Acceptance: A4

### Scenario: Reasoning continuity in a tool loop

A thinking-enabled task calls at least two tools across multiple model turns. Every
subsequent request includes the prior assistant `reasoning_content`, the requested
effort is applied, and the task reaches a final result without a reasoning-continuity
provider error.

Acceptance: A5

### Scenario: Stable prefix and cache telemetry

Two consecutive requests in a session reuse the same static prefix and append new
history. The session reports cache-hit/cache-miss tokens plus input, output, latency, and
model identity supplied by the provider.

Acceptance: A6

### Scenario: Automatic and explicit routing

A routine task resolves to the active `deepseek-flash` model. A `deepseek-v4-pro`
request resolves to `deepseek-flash` with the alias resolution recorded. An explicit
selection of an active canonical alternative overrides auto selection when one is
present, and the session records the override and route reason.

Acceptance: A7

### Scenario: Invalid provider configuration

An invalid URL, missing credential, unsupported protocol, non-DeepSeek model identifier,
or capability mismatch is tested. NeonForge returns an actionable error, sends no model
request, records no false success, and leaves the session in a healthy recoverable state.

Acceptance: A12

### Scenario: Protocol adapter conformance

OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages adapters each pass
streaming, tool-call, reasoning, usage, error, and cancellation tests against controlled
fixtures. Each adapter rejects a non-DeepSeek model before making a provider request,
and at least one real provider path is recorded for each protocol.

Acceptance: A15
