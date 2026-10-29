# NeonForge V2 Final Delivery Shape

## Outcome

NeonForge V2 is the final delivered product: a universal professional AI workbench for
software engineering and technical operations. It is local-first, single-user, BYOK, and
available as a CLI TUI and a Desktop application on macOS, Linux, and Windows.

CLI TUI and Desktop share one agent runtime, session format, permission model, provider
registry, DeepSeek model policy, usage data, and artifact store. A task started in either
surface can be resumed or inspected in the other.

The product accepts providers that serve DeepSeek-family models through OpenAI Chat
Completions, OpenAI Responses, or Anthropic Messages. Provider model identifiers may use
vendor prefixes and naming; they must identify a DeepSeek-family model unambiguously.

## Product Principles

- DeepSeek-native runtime: thinking mode, reasoning effort, tool-call reasoning
  continuity, context caching, usage accounting, and model selection are first-class.
- Strict model policy, flexible providers: providers are adapters, while canonical
  DeepSeek model identity governs capability and acceptance.
- Local-first and inspectable: workspaces, sessions, approvals, artifacts, and usage
  remain local unless content is intentionally sent to a configured provider or web tool.
- Human control at consequential boundaries: writes, shell commands, outbound network
  access, destructive actions, and credential access follow an explicit permission mode.
- One runtime, two surfaces: CLI TUI is automation-friendly and headless-capable; Desktop
  adds visual review, navigation, diffs, approvals, and settings without forking core
  behavior.

## Scope

### Product Surface

- CLI TUI: interactive tasks, provider/model configuration, approvals, session
  inspection, resume, cancel, export, diagnostics, and NDJSON headless mode.
- Desktop: workspace selection, session list, live timeline, approval cards, diffs,
  command output, artifacts, usage, provider/model/thinking/permission settings, resume,
  cancel, and export.
- Both surfaces support macOS, Linux, and Windows.

### Agent Runtime

- Workspace-bound delegated tasks with resumable event history.
- Tools for directory listing, file read/search/write/patch, shell execution, web fetch,
  and provider-supported web search.
- Approval, denial, cancellation, timeout, recovery, and evidence recording.
- Stable machine-readable event records shared by both surfaces.
- Thinking mode, reasoning effort, reasoning-content continuity, cache-friendly prompt
  construction, model selection, and usage/cost telemetry.

### DeepSeek Model Layer

- Canonical registry for DeepSeek model families, aliases, capabilities, limits, and
  modalities.
- DeepSeek-family recognition by model identifier, without exact canonical-name matching.
- Optimization baseline: `deepseek-flash`.
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
- Secrets are redacted from logs, events, exports, crash records, and terminal/Desktop
  output.

### Packaging

- CLI TUI and Desktop installers are distributed separately for macOS, Linux, and
  Windows.
- Every platform/architecture installer is smaller than 50,000,000 bytes.
- Installers include the NeonForge runtime code required for first launch.
- Installers exclude model weights and a full browser engine.
- Desktop uses Tauri 2 with the operating-system WebView: WKWebView on macOS, WebView2 on
  Windows, and WebKitGTK 4.1 on Linux.
- First launch does not download a browser runtime, hidden language runtime, or model
  weights.

### Verification

- Three-platform smoke for CLI TUI and Desktop.
- 12 personas x 3 platforms x 2 surfaces = 72 deterministic AI-user E2E scenarios.
- Protocol conformance tests for all three protocols.
- Immutable external-baseline snapshot from authoritative published DeepSeek benchmark
  data or aggregated leaderboard values.
- Local baseline registry containing confirmed benchmark suites, official data, methods,
  raw source files, retrieval metadata, and integrity hashes; it must remain
  offline-verifiable and must not claim a score that NeonForge has not actually run.
- Bug Hunt Bench harness-score comparison against the published high-effort leaderboard:
  NeonForge + DeepSeek V4.1 Flash 1017, 105 planted bugs across two production
  repositories, identical benchmark prompts, high effort, 5 attempts per task, 3 hours
  per repository, no network or git history, and blind grading against the withheld
  answer key. The pass target is at least 40.4 fixed/105, tying the published Pi and
  Grok Build CLI high-effort leaders.
- Continued collection of additional authoritative benchmark suites and methods, with
  at least two additional reviewed candidate suites beyond the DeepSeek official
  baseline and Bug Hunt Bench stored locally, or an explicit unavailable/unsuitable
  reason recorded for each candidate.
- Optimized-versus-unoptimized A/B efficiency validation for both surfaces.
- Every required test case must pass; skipped, blocked, timed-out, flaky, or waived cases
  do not count.

## Directory Structure

### Created

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` - monorepo foundation.
- `apps/cli/` - CLI TUI and headless command surface.
- `apps/desktop/` - Desktop web UI.
- `apps/desktop/src-tauri/` - Tauri native shell, WebView integration, packaging, and
  installer configuration.
- `packages/core/` - sessions, agent loop, tools, permissions, events, and persistence.
- `packages/deepseek/` - DeepSeek registry, routing, thinking, caching, and usage.
- `packages/protocols/` - OpenAI Chat Completions, OpenAI Responses, and Anthropic
  Messages adapters.
- `packages/config/` - configuration and secret-store integration.
- `packages/shared/` - schemas, event contracts, validation, errors, and utilities.
- `packages/ui/` - Desktop components and interaction primitives.
- `tests/` - unit, integration, provider-contract, CLI, and Desktop tests.
- `tests/e2e/` - cross-platform, persona-driven E2E scenarios.
- `tests/personas/` - seeded persona definitions and simulator/evaluator fixtures.
- `benchmarks/` - external-baseline snapshots, A/B runners, and reports.
- `benchmarks/registry.json` - versioned index of confirmed baseline suites, source
  files, methods, hashes, and availability.
- `benchmarks/sources/` - locally stored authoritative source documents and raw data.
- `benchmarks/adapters/bug-hunt-bench/` - Bug Hunt Bench task, harness, scoring, and
  evidence adapter used for the V2 measured run.
- `scripts/release/` - deterministic packaging and installer-size verification.
- `.github/workflows/` - native macOS, Linux, and Windows release matrix.
- `README.md` - product overview, setup, supported scope, and security model.

### Not Created

- Hosted account, billing, team, cloud-sync, or multi-tenant backend.
- Public plugin marketplace or arbitrary untrusted plugin execution.
- Non-DeepSeek model adapters.

## Non-Goals

- General-purpose chat detached from a workspace or delegated outcome.
- Models from OpenAI, Anthropic, Google, Qwen, or any non-DeepSeek family.
- Hosted SaaS, team administration, shared cloud workspaces, or managed billing.
- General office, CRM, ERP, or non-technical department workflows.
- Full IDE, spreadsheet editor, office document editor, or visual design suite.
- Arbitrary untrusted plugin execution or a public extension marketplace.
- Unattended high-risk automation without permission policy and audit events.
- Training, fine-tuning, or redistributing DeepSeek models.
- Model weights or a full browser engine inside installers.
- Custom model-name mappings or canonical-model overrides.

## Acceptance Examples

- F1: A CLI TUI task reads project files, requests approvals for a write and shell
  command, applies them, and records a final outcome with evidence.
- F2: A Desktop task performs the same workflow with visual approvals and evidence.
- F3: A session created in CLI TUI opens in Desktop with identical events, approvals,
  diffs, usage, and outcome; a Desktop-created session does the reverse.
- F4: Desktop starts, resumes, cancels, and exports sessions on macOS, Linux, and Windows.
- F5: CLI TUI and headless mode share one persisted session format and can inspect each
  other's sessions.
- F6: Official and third-party DeepSeek providers work through all three protocols using
  base URL, API key, model identifier, and protocol, including vendor-prefixed names.
- F7: Non-DeepSeek model identifiers are rejected before a provider request.
- F8: Reasoning content is preserved across a multi-step tool loop with the requested
  effort.
- F9: Consecutive requests reuse a stable prefix and report cache hit/miss, token,
  latency, and model data.
- F10: Auto and explicit model selection resolve through the active registry and record
  alias/routing decisions.
- F11: Balanced and workspace-auto permission modes behave correctly on both surfaces.
- F12: Interrupted or cancelled sessions resume without losing events, approvals, or
  artifacts.
- F13: Secrets never appear in logs, exports, crash records, terminal output, or Desktop
  UI.
- F14: Headless CLI emits stable NDJSON with deterministic exit categories and
  `approval-required` behavior.
- F15: Invalid provider configuration fails before a model request and leaves a healthy
  recoverable session.
- F16: Every CLI TUI installer is smaller than 50,000,000 bytes on each supported
  platform/architecture.
- F17: Every Desktop installer is smaller than 50,000,000 bytes on each supported
  platform/architecture.
- F18: CLI TUI and Desktop each launch and complete a smoke task on macOS, Linux, and
  Windows.
- F19: All three protocol adapters pass streaming, tool-call, reasoning, usage, error,
  cancellation, and DeepSeek-policy conformance tests.
- F20: All 72 persona E2E scenarios pass deterministic functional assertions with no P0
  or P1 defect.
- F21: The external-baseline snapshot contains authoritative published values with
  source URLs, publisher, version, retrieval date, raw values, units, aggregation
  method, and integrity hash.
- F22: Optimized runs reduce cost per successful task by at least 15% and median
  wall-clock time by at least 10%, with no more than a 2 percentage-point success-rate
  regression on both surfaces.
- F23: NeonForge + DeepSeek V4.1 Flash 1017 completes the Bug Hunt Bench protocol at
  high effort and scores at least 40.4 fixed/105 under blind grading, with the repo
  split, run count, wall time, cost, and raw evidence recorded.
- F24: The local baseline registry contains at least two additional reviewed
  authoritative benchmark suites or methods beyond the DeepSeek official baseline and
  Bug Hunt Bench, each with source files, retrieval metadata, methodology notes,
  integrity hash, and offline verification; unavailable or unsuitable candidates are
  recorded with reasons.

## Constraints and Invariants

- Every task is bound to a local workspace root.
- Only DeepSeek-family models resolvable through the built-in registry are allowed.
- CLI TUI and Desktop use the same core contracts and session format.
- Credentials never appear in workspace files, logs, exports, or reports.
- Destructive and outbound actions have auditable approval or denial events.
- The product runs without a NeonForge-hosted backend.
- Required platforms are macOS, Linux, and Windows.
- Installer size is measured on the final compressed artifact.
- A skipped, blocked, timed-out, or flaky required case is not a pass.

## Decisions

- Product: NeonForge V2 Final Delivery.
- Category: local-first AI workbench for technical operations.
- Surfaces: CLI TUI and Desktop at core task-execution parity.
- Platforms: macOS, Linux, and Windows.
- Model policy: DeepSeek-only.
- Protocols: OpenAI Chat Completions, OpenAI Responses, Anthropic Messages.
- Permission modes: balanced by default; workspace-auto by explicit opt-in.
- Desktop implementation: Tauri 2 with the operating-system WebView.
- Distribution: separate CLI TUI and Desktop installers, each under 50,000,000 bytes.
- Verification: 72 persona E2E, three-protocol conformance, external baseline snapshot,
  local baseline registry, Bug Hunt Bench score >= 40.4, and two-surface efficiency A/B.
- Resource baseline: CNY 1,000 calibration pilot; CNY 20,000 cap; 8 workers; 10 QPS per
  provider; 10 working days after harness readiness.
