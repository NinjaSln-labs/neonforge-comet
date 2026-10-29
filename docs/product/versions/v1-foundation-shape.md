# NeonForge V1 Foundation Shape

## Outcome

NeonForge V1 Foundation is a local-first AI workbench for software engineering and
technical operations. It delivers a CLI TUI and headless mode on macOS, Linux, and
Windows. Both modes share one agent runtime, session format, permission model, provider
registry, DeepSeek-only model layer, usage data, and artifact store.

V1 accepts providers that serve DeepSeek-family models through OpenAI Chat Completions,
OpenAI Responses, or Anthropic Messages. Provider model identifiers may use vendor
prefixes and naming; they must identify a DeepSeek-family model unambiguously.

The complete final-delivery shape is defined separately in
`docs/product/versions/v2-final-delivery-shape.md`.

## Scope

### Product Surface

- CLI TUI for interactive tasks, approvals, session inspection, resume, cancel, export,
  provider/model configuration, and diagnostics.
- Headless mode for NDJSON automation and CI.
- Both modes support macOS, Linux, and Windows.

### Agent Runtime

- Workspace-bound delegated tasks with resumable event history.
- Tools for directory listing, file read/search/write/patch, shell execution, web fetch,
  and provider-supported web search.
- Approval, denial, cancellation, timeout, recovery, and evidence recording.
- Stable machine-readable events shared by TUI and headless mode.
- Thinking mode, reasoning effort, reasoning-content continuity, cache-friendly prompt
  construction, model selection, and usage/cost telemetry.

### DeepSeek Model Layer

- Canonical registry for DeepSeek model families, aliases, capabilities, limits, and
  modalities.
- DeepSeek-family recognition by model identifier, without requiring an exact canonical
  name match.
- V1 optimization baseline: `deepseek-flash`.
- Compatibility aliases resolve to canonical models.
- Supported protocols: OpenAI Chat Completions, OpenAI Responses, Anthropic Messages.
- Provider configuration: base URL, API key, model name, protocol, optional non-secret
  headers, timeout, and proxy settings.
- No custom canonical-model override; vendor-prefixed DeepSeek identifiers are accepted.
- Non-DeepSeek model identifiers are rejected before a provider request.

### Permissions and Security

- `balanced`: reads are automatic; writes, shell commands, outbound requests, and
  destructive actions require approval.
- `workspace-auto`: ordinary workspace writes are automatic; shell, outbound,
  destructive, credential, and out-of-workspace actions require approval.
- Credentials use the operating-system secret store.
- Secrets are redacted from logs, events, exports, crash records, and terminal output.

### Packaging

- CLI TUI installers are distributed for macOS, Linux, and Windows.
- Every platform/architecture installer is smaller than 50,000,000 bytes.
- Installers include the runtime code required for first launch.
- Installers exclude model weights, a browser engine, and a hidden runtime download.

### Verification

- Three-platform CLI TUI smoke.
- 12 personas x 3 platforms = 36 deterministic AI-user E2E scenarios.
- Protocol conformance tests for all three protocols.
- Immutable external-baseline snapshot from authoritative published DeepSeek benchmark
  data or aggregated leaderboard values.
- Local baseline registry containing confirmed benchmark suites, official source data,
  methods, raw files, retrieval metadata, and integrity hashes. V1 includes the DeepSeek
  official baseline plus a Bug Hunt Bench snapshot and executable adapter contract; it
  does not claim a NeonForge Bug Hunt Bench score.
- Optimized-versus-unoptimized efficiency A/B.
- Every required test case must pass; skipped, blocked, timed-out, flaky, or waived cases
  do not count.

## Directory Structure

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` - monorepo foundation.
- `apps/cli/` - CLI TUI and headless command surface.
- `packages/core/` - sessions, agent loop, tools, permissions, events, and persistence.
- `packages/deepseek/` - DeepSeek registry, routing, thinking, caching, and usage.
- `packages/protocols/` - OpenAI Chat Completions, OpenAI Responses, and Anthropic
  Messages adapters.
- `packages/config/` - configuration and secret-store integration.
- `packages/shared/` - schemas, event contracts, validation, errors, and utilities.
- `tests/` - unit, integration, provider-contract, CLI TUI, and headless tests.
- `tests/e2e/` - cross-platform, persona-driven E2E scenarios.
- `tests/personas/` - seeded persona definitions and simulator/evaluator fixtures.
- `benchmarks/` - local baseline registry, immutable source snapshots, benchmark adapter
  contracts, A/B runners, and reports.
- `benchmarks/sources/` - locally stored authoritative source files and retrieval
  metadata.
- `benchmarks/adapters/bug-hunt-bench/` - task-format, harness, and scorer contract for
  the V2 Bug Hunt Bench run.
- `scripts/release/` - deterministic packaging and installer-size verification.
- `.github/workflows/` - native macOS, Linux, and Windows release matrix.
- `docs/product/versions/v2-final-delivery-shape.md` - V2 final-delivery shape.
- `README.md` - product overview, setup, supported scope, and security model.

## Non-Goals

- Desktop in V1.
- Hosted account, billing, team, cloud-sync, or multi-tenant backend.
- Public plugin marketplace or arbitrary untrusted plugin execution.
- Non-DeepSeek model adapters.
- General office, CRM, ERP, or non-technical department workflows.
- Full IDE, spreadsheet editor, office document editor, or visual design suite.
- Unattended high-risk automation without permission policy and audit events.
- Training, fine-tuning, or redistributing DeepSeek models.
- Model weights or a browser engine inside installers.
- Custom model-name mappings or canonical-model overrides.
- Claiming a NeonForge Bug Hunt Bench score in V1; the actual comparison is a V2
  Final Delivery acceptance item.

## Acceptance Examples

- A1: A CLI task reads project files, requests approvals for a write and shell command,
  applies them, and records a final outcome with evidence.
- A2: The CLI TUI renders a live session timeline; headless commands inspect and export
  the same persisted session format.
- A3: Official and third-party DeepSeek providers work using base URL, API key, model
  identifier, and protocol, including vendor-prefixed DeepSeek names.
- A4: Non-DeepSeek model identifiers are rejected before a provider request.
- A5: Reasoning content is preserved across a multi-step tool loop with the requested
  effort.
- A6: Requests reuse a stable prefix and report cache hit/miss, token, latency, and model
  data.
- A7: Auto and explicit model selection resolve through the active registry and record
  alias/routing decisions.
- A8: Balanced and workspace-auto permission modes behave correctly.
- A9: Interrupted or cancelled sessions resume without losing events, approvals, or
  artifacts.
- A10: Secrets never appear in logs, exports, crash records, or terminal output.
- A11: Headless CLI emits stable NDJSON with deterministic exit categories and
  `approval-required` behavior.
- A12: Invalid provider configuration fails before a model request and leaves a healthy
  recoverable session.
- A13: Every CLI TUI installer is smaller than 50,000,000 bytes on each supported
  platform/architecture.
- A14: The CLI TUI launches and completes a smoke task on macOS, Linux, and Windows.
- A15: All three protocol adapters pass streaming, tool-call, reasoning, usage, error,
  cancellation, and DeepSeek-policy conformance tests.
- A16: All 36 persona E2E scenarios pass deterministic functional assertions with no P0
  or P1 defect.
- A17: The external-baseline snapshot contains authoritative published values with
  source URLs, publisher, version, retrieval date, raw values, units, aggregation
  method, and integrity hash.
- A18: Optimized runs reduce cost per successful task by at least 15% and median
  wall-clock time by at least 10%, with no more than a 2 percentage-point success-rate
  regression.
- A19: Confirmed authoritative benchmark suites, official data, methods, and source
  files are stored locally in a versioned baseline registry with provenance, hashes,
  and offline integrity verification; the registry includes the DeepSeek official
  baseline and a Bug Hunt Bench snapshot plus adapter contract, and unconfirmed sources
  never become canonical.

## Constraints and Invariants

- Every task is bound to a local workspace root.
- Only DeepSeek-family models resolvable through the built-in registry are allowed.
- CLI TUI and headless mode use the same core contracts and session format.
- Credentials never appear in workspace files, logs, exports, or reports.
- Destructive and outbound actions have auditable approval or denial events.
- The product runs without a NeonForge-hosted backend.
- Required platforms are macOS, Linux, and Windows.
- Installer size is measured on the final compressed artifact.
- A skipped, blocked, timed-out, or flaky required case is not a pass.

## Decisions

- Product: NeonForge V1 Foundation.
- Category: local-first AI workbench for technical operations.
- Surfaces: CLI TUI and headless mode.
- Platforms: macOS, Linux, and Windows.
- Model policy: DeepSeek-only.
- Protocols: OpenAI Chat Completions, OpenAI Responses, Anthropic Messages.
- Permission modes: balanced by default; workspace-auto by explicit opt-in.
- Distribution: CLI TUI installers under 50,000,000 bytes.
- Verification: 36 persona E2E, three-protocol conformance, external baseline snapshot,
  local baseline registry with Bug Hunt Bench adapter, and efficiency A/B.
- V2 final-delivery harness comparison: NeonForge + DeepSeek V4.1 Flash 1017 on Bug Hunt
  Bench, high effort, 5 attempts per task, 3 hours per repository, blind grading, with a
  target of at least 40.4 fixed/105 to tie the published Pi/Grok high-effort leaders.
- Resource baseline: CNY 1,000 calibration pilot; CNY 20,000 cap; 8 workers; 10 QPS per
  provider; 10 working days after harness readiness.

The formal Comet workflow copy of this Shape is
`docs/comet/changes/neonforge-foundation/brief.md`.
