# Outcome

NeonForge is a universal professional AI workbench. V1 focuses on software engineering
and technical operations and delivers the CLI TUI plus headless mode. The TUI and
headless mode share one agent runtime, session history, permission model, and
DeepSeek-only model layer. Core contracts remain surface-neutral for the final delivery.

The product accepts any provider that serves DeepSeek-family models, including the
official DeepSeek API and compatible third-party gateways. Provider flexibility must
not weaken the model restriction: NeonForge exposes only verified DeepSeek-family
models and rejects non-DeepSeek models before a task starts.

V1 provides a complete technical workbench rather than a connector marketplace: create
and resume a delegated task, inspect and edit a local workspace, run commands and web
tools under approvals, review diffs and outcomes, configure a DeepSeek provider, and
observe model/cache/token usage from the TUI and headless output. The CLI TUI is
distributed for macOS, Linux, and Windows.

This document defines V1 Foundation only. The complete final-delivery shape is
`docs/product/versions/v2-final-delivery-shape.md`.

## Product principles

- DeepSeek-native, not merely OpenAI-compatible: reasoning effort, thinking output,
  tool-call reasoning continuity, context caching, JSON output, and model routing are
  first-class runtime concerns.
- Provider-agnostic below a strict model policy: providers are adapters; canonical
  DeepSeek model identity and capability metadata govern behavior.
- Local-first and inspectable: workspace files, session events, approvals, and usage
  remain local unless the user intentionally sends content to a configured model or
  web tool.
- Human control at consequential boundaries: file mutation, shell execution,
  outbound network access, and risky commands follow an explicit permission policy.
- One runtime, two modes: the CLI TUI provides interactive work, while headless mode
  provides automation and stable machine output. Both share the same core contracts.

# Scope

## Product capabilities

### 1. Workspace-bound agent sessions

- Select a local workspace and create a task with an explicit objective.
- Maintain a resumable event history for messages, plans, tool calls, approvals,
  model output, errors, artifacts, and final outcome.
- Stream progress and support cancellation without losing the session record.
- Bound execution to the selected workspace.

### 2. Agent execution runtime

- Provide a model-driven loop with workspace file operations, search, shell commands,
  web search/fetch, plan/todo state, and structured final delivery.
- Support approval requests and denials with clear reasons and safe resumption.
- Record objective evidence such as changed files, command results, and generated
  artifacts.

### 3. DeepSeek-only model layer

- Maintain a canonical registry of allowed DeepSeek model families, aliases,
  capabilities, context/output limits, thinking support, tool support, and modality.
- Recognize DeepSeek-family provider model identifiers without requiring an exact
  canonical-name match; provider prefixes and vendor naming are preserved.
- Normalize provider differences behind one request/response contract.
- Resolve `auto` and explicit model choices against the active DeepSeek registry, record
  alias resolution and routing reasons, and never change models silently mid-run.
- Expose thinking mode and reasoning effort (`low`, `high`, `max`) where supported.
- Preserve `reasoning_content` correctly during multi-step tool loops.
- Build cache-friendly append-only prompt prefixes and report cache-hit/miss usage.
- Track token usage, estimated provider-reported cost, latency, and model identity.

### 4. Provider adapters

- Support the official DeepSeek endpoint out of the box.
- Allow user-defined providers through the same standard configuration pattern used by
  agent CLIs for third-party LLM access: base URL, API key, model name, and protocol.
- Support the current mainstream model API types used to serve DeepSeek models:
  OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages.
- Provide one normalized adapter contract for streaming, tool calls, reasoning content,
  usage, cancellation, and errors across all supported protocol types.
- Validate provider/model combinations against the DeepSeek-only policy before use.
- Store credentials in the operating-system secret store and redact them from logs.
- Surface provider health, authentication, endpoint, and capability mismatches.
- Require the provider model identifier to identify a DeepSeek-family model
  unambiguously. Exact provider IDs need not match a canonical name.

### 5. CLI

- Provide a cross-platform terminal UI (TUI) for interactive delegated tasks, plus
  non-interactive/headless runs.
- Select and configure providers and models.
- List, resume, inspect, cancel, and export sessions.
- Present streamed progress, approvals, diffs, errors, and final outcomes in a
  terminal-friendly form.
- Support stable machine-readable output for automation and CI.
- Keep surface-neutral core contracts.
- Run on macOS, Linux, and Windows.

### 6. Safety, privacy, and observability

- Enforce workspace boundaries and explicit approvals according to policy.
- Redact secrets and sensitive request fields from terminal output, logs, and exports.
- Clearly distinguish local data, provider-bound data, and outbound web data.
- Provide diagnostics that never print credentials.
- Offer two permission modes: balanced by default, and workspace-autonomous when the
  user explicitly selects it.

### 7. Distribution footprint

- Every supported CLI TUI platform/architecture installer must be smaller than
  50,000,000 bytes as a compressed distributable artifact.
- Required v1 CLI TUI platforms are macOS, Linux, and Windows.
- The installer must include the NeonForge CLI binary and all NeonForge-specific runtime
  code required for first launch.
- Model weights, development dependencies, source maps, and unnecessary native runtime
  payloads are excluded from the installer.
- First launch must not download model weights or a hidden language runtime; provider
  access happens only when the user runs a task.
- Release verification records each installer path, platform, architecture, and exact
  byte size, and fails when any artifact is at or above the limit.

### 8. Verification and quality gates

- Three-platform smoke is the minimum gate: the CLI TUI must launch and complete a smoke
  task on macOS, Linux, and Windows.
- A comprehensive AI persona E2E suite uses seeded, independent DeepSeek-backed user
  simulators across at least 12 materially different personas and 3 platforms on the
  CLI TUI. Functional assertions are deterministic; a separate evaluator checks
  communication quality, and the simulated user never judges its own session.
- Model-quality acceptance uses an immutable snapshot of authoritative published
  DeepSeek benchmark data or an authoritative aggregated leaderboard. The snapshot
  records source URLs, publisher, benchmark version, retrieval date, raw values, and a
  content hash. NeonForge does not claim to reproduce the publisher's full laboratory
  environment or substitute self-generated benchmark baselines.
- Confirmed benchmark suites, official data, methods, and raw source files are stored
  locally in a versioned baseline registry with provenance, retrieval metadata, and
  SHA-256 hashes. V1 includes the DeepSeek official baseline, a Bug Hunt Bench snapshot,
  and a Bug Hunt Bench adapter contract; it does not claim a NeonForge Bug Hunt Bench
  score. The registry is offline-verifiable and never promotes an unconfirmed source to
  canonical status.
- Deterministic NeonForge protocol, conformance, and E2E tests must still pass 100%. They
  validate NeonForge integration and behavior; they are not presented as third-party
  model-quality baseline data.
- A controlled optimization A/B test compares NeonForge with the unoptimized baseline on
  identical tasks, model, protocol, permissions, and fixtures. It measures success rate,
  wall-clock time, input/output/reasoning tokens, cache hit/miss, tool calls, user
  interventions, and cost per successful task.
- Verification reports are machine-readable and reproducible; flaky, skipped, blocked,
  or time-boxed cases do not count as passed.

## Directory structure

### Created

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` - TypeScript monorepo
  foundation and shared scripts.
- `apps/cli/` - interactive and headless command-line surface.
- `packages/core/` - task/session lifecycle, agent loop, tools, permissions, events,
  and persistence contracts.
- `packages/deepseek/` - DeepSeek model registry, provider adapters, normalization,
  routing, thinking, caching, and usage accounting.
- `packages/protocols/` - OpenAI Chat Completions, OpenAI Responses, and Anthropic
  Messages adapters plus shared conformance contracts.
- `packages/shared/` - shared schemas, event types, validation, errors, and utilities.
- `packages/config/` - configuration schema, workspace settings, and secret-store
  integration.
- `tests/` - cross-package integration, provider-contract, CLI TUI, and headless smoke
  tests.
- `tests/e2e/` - cross-platform, persona-driven end-to-end scenarios.
- `tests/personas/` - seeded persona definitions and simulator/evaluator fixtures.
- `benchmarks/` - external-baseline snapshots, efficiency A/B runners, and
  machine-readable reports.
- `benchmarks/registry.json` - versioned index of confirmed benchmark suites, sources,
  methods, hashes, and availability.
- `benchmarks/sources/` - locally stored authoritative source files and retrieval
  metadata.
- `benchmarks/adapters/bug-hunt-bench/` - executable adapter contract for the V2
  Bug Hunt Bench harness comparison.
- `scripts/release/` - deterministic release build and installer-size verification.
- `.github/workflows/` - native macOS, Linux, and Windows release-build matrix.
- `docs/product/versions/v1-foundation-shape.md` - complete V1 product shape.
- `docs/product/versions/v2-final-delivery-shape.md` - complete V2 final-delivery shape.
- `README.md` - product overview, supported scope, setup, and security model.

### Not created

- A hosted account, billing, team, or cloud-sync backend - v1 is local-first and
  single-user; adding cloud tenancy would materially expand the product and security
  boundary.
- A general plugin marketplace - v1 exposes a controlled provider adapter interface,
  not an untrusted third-party package ecosystem.
- Non-DeepSeek model adapters - the product policy explicitly excludes them.

## V1 boundaries

- The primary v1 user is a developer or technical operator working in a local project.
- The workbench may handle research and document tasks inside the selected workspace,
  but v1 is not a general spreadsheet or office-document suite.
- v1 is local-first, BYOK, and single-user, with no NeonForge-hosted inference,
  accounts, cloud sync, or billing.
- The CLI TUI is the only interactive product surface in v1; headless mode shares the
  same core and session model.
- The default permission policy is balanced: reads are automatic, while writes, shell
  execution, and outbound network calls require approval unless the user enables
  workspace-autonomous mode.
- Workspace-autonomous mode automates ordinary writes inside the workspace, but keeps
  approval gates for shell execution, outbound network access, destructive operations,
  credential access, and writes outside the workspace.

# Non-goals

- General-purpose chat that is not attached to a workspace or delegated outcome.
- Models from OpenAI, Anthropic, Google, Qwen, or any non-DeepSeek family.
- A hosted multi-tenant SaaS, team administration, shared cloud workspaces, or managed
  billing in v1.
- General office, CRM, ERP, and non-technical department workflows in v1.
- A full IDE, spreadsheet editor, office document editor, or general visual design tool.
- Arbitrary untrusted plugin execution or a public extension marketplace.
- Unattended high-risk automation without explicit permission policy and audit events.
- Training, fine-tuning, or redistributing DeepSeek models.
- Bundling model weights or a browser engine in any installer.
- A Desktop application in V1.
- Custom provider model-name mappings and canonical-model overrides in v1.

# Acceptance examples

- A CLI task in a selected local workspace reads project files, requests approval for a
  file mutation and shell command, applies the approved actions, and records a final
  outcome with evidence.
- The CLI TUI renders a live session timeline with approvals, diffs, command output,
  usage, and final outcome; headless commands inspect and export the same persisted
  session format.
- A user can configure the official DeepSeek endpoint and a compatible third-party
  endpoint with a base URL, API key, model name, and supported protocol, then complete a
  task through either provider when the model identifier is recognized as DeepSeek
  family, including vendor-prefixed names.
- A provider offering a non-DeepSeek model cannot expose or execute that model through
  NeonForge, and the CLI explains which policy check failed.
- During a DeepSeek tool-call loop, reasoning content is preserved across every
  subsequent request, reasoning effort is respected, and the task continues without a
  reasoning-continuity provider error.
- Repeated requests in one session use a stable prompt prefix and report cache-hit,
  cache-miss, input-token, output-token, latency, and model data.
- Model selection resolves against the active DeepSeek registry: `deepseek-flash` is the
  v1 optimization baseline, compatibility aliases resolve to their canonical model,
  auto selection records its reason, and an explicit canonical model choice overrides
  auto selection when an active alternative exists.
- In balanced mode, writes, shell commands, and outbound requests require approval; in
  workspace-autonomous mode, ordinary workspace writes proceed but shell and outbound
  actions still require approval, and every decision is recorded.
- A failed, cancelled, or interrupted run remains resumable and retains its events,
  pending approvals, and generated artifacts.
- Secrets are absent from logs, exports, crash reports, and terminal output after a task
  that exercises provider authentication.
- Headless CLI output uses a stable machine-readable event stream, deterministic exit
  categories, and a non-zero result when a required approval cannot be obtained.
- An invalid provider URL, credential, model name, or capability mismatch produces
  an actionable error, does not start a model request, and leaves the session healthy.
- Each macOS, Linux, and Windows CLI TUI installer is a compressed artifact smaller than
  50,000,000 bytes, contains the NeonForge runtime code required for first launch,
  excludes model weights and a browser engine, and has recorded release evidence for its
  platform, architecture, and exact size.
- The CLI TUI launches and completes a smoke task on macOS, Linux, and Windows, with
  release evidence recorded for every platform.
- OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages adapters each pass
  streaming, tool-call, reasoning, usage, error, and cancellation conformance tests
  while enforcing the DeepSeek-only model policy.
- The AI persona E2E matrix runs at least 12 personas on the CLI TUI across 3 platforms
  (36 scenarios), and every deterministic functional assertion passes with no P0 or P1
  defect.
- The external baseline snapshot records authoritative published DeepSeek benchmark or
  aggregated leaderboard values for `deepseek-flash` with source URLs, publisher,
  version, retrieval date, raw values, and integrity hash; product documentation and
  verification reports use those values without claiming local reproduction.
- Confirmed benchmark suites, official data, methods, and raw source files are stored
  locally with source URLs, retrieval metadata, license/redistribution notes, and
  SHA-256 hashes. A registry verification command works offline and fails on drift,
  missing files, or unconfirmed canonical promotion. The registry includes DeepSeek
  official data, a Bug Hunt Bench snapshot, and a Bug Hunt Bench adapter contract.
- The optimized runtime demonstrates the confirmed real-use efficiency improvement
  against the unoptimized baseline without reducing task success beyond the confirmed
  non-inferiority margin.
# Constraints and invariants

- A task is always bound to a local workspace root.
- Only canonical DeepSeek-family models may be requested. Provider discovery, aliases,
  and manual configuration cannot bypass the policy.
- Provider-specific fields must be normalized without discarding DeepSeek-specific
  behavior needed for reasoning and tool calls.
- CLI TUI and headless mode use the same core contracts and persisted session format.
- Credentials are never stored in plaintext project files or included in exported
  session artifacts.
- Destructive or outbound actions have an auditable approval/denial event.
- The first release must run without a NeonForge-hosted backend.
- v1 provider support includes OpenAI Chat Completions, OpenAI Responses, and Anthropic
  Messages; every protocol must enforce the same DeepSeek-only model policy.
- A provider model identifier must unambiguously identify a DeepSeek-family model before
  use. Exact matching to a canonical alias is not required; non-DeepSeek identifiers are
  rejected.
- Installer size is measured in bytes on the final compressed platform artifact, not on
  the unpacked application directory.
- CLI TUI platforms: macOS, Linux, and Windows.
- A skipped, blocked, timed-out, or flaky acceptance case is not a pass.

# Decisions

- Product name: NeonForge.
- Long-term product category: universal professional AI workbench.
- v1 product category: local-first AI workbench for software engineering and technical
  operations.
- Interfaces: CLI TUI and headless mode, sharing one runtime and session model.
- Platform support: the CLI TUI runs on macOS, Linux, and Windows.
- V1 scope: CLI TUI and headless mode only. V2 Final Delivery is defined in the separate
  version-shape document.
- Model policy: DeepSeek-family models only.
- Provider policy: any provider that serves DeepSeek-family models may be configured,
  after validation; v1 uses the standard agent-CLI pattern of base URL, API key, model
  name, and protocol. Supported protocols are OpenAI Chat Completions, OpenAI
  Responses, and Anthropic Messages. The model identifier must identify DeepSeek family;
  provider prefixes and vendor naming are allowed.
- Custom model-name mapping and canonical-model overrides are excluded from v1 so the
  DeepSeek-only optimization baseline remains verifiable.
- v1 defaults: BYOK credentials, single user, no cloud sync, no managed billing.
- Permission policy: balanced mode is the default; workspace-autonomous mode is an
  explicit opt-in per workspace or session.
- v1 implementation stack: a TypeScript pnpm monorepo with one shared core used by the
  CLI TUI and headless mode.
- Distribution: each CLI TUI installer must be `< 50,000,000` bytes; model weights and a
  browser engine are excluded. Required platforms are macOS, Linux, and Windows.
- Model-quality verification uses authoritative published DeepSeek benchmark or
  aggregated leaderboard data as an immutable external baseline; no self-generated model
  baseline or full-environment reproduction is claimed.
- Product verification uses deterministic protocol/E2E tests plus a controlled
  optimized-versus-unoptimized NeonForge efficiency experiment.
- Benchmark pass criteria: deterministic NeonForge tests must pass 100%; published
  external baseline values are cited exactly and never presented as local measurements.
- Baseline storage: confirmed suites and official data are immutable local snapshots
  with provenance and hashes; additional authoritative suites and methods are collected
  during delivery, and unconfirmed or unavailable sources are explicitly staged or
  marked unavailable rather than treated as canonical.
- V2 harness-score comparison: Bug Hunt Bench, DeepSeek V4.1 Flash 1017, high effort,
  5 attempts per task, 3 hours per repository, blind grading, target at least 40.4
  fixed/105.
- Efficiency thresholds: at least 15% lower cost per successful task and 10% lower
  median wall-clock time, with no more than a 2 percentage-point success-rate regression.
- Acceptance run resources: CNY 1,000 calibration pilot; CNY 20,000 total cap before
  pause/reapproval; 8 concurrent task workers; 10 QPS per provider; 10 working days
  after the harness is ready; one real DeepSeek-serving provider path for each of the
  three supported protocols.
