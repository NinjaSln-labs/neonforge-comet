# Verification and Benchmarks

## Purpose

NeonForge v1 is not complete when features merely exist. It must demonstrate
cross-platform usability, broad persona compatibility, protocol conformance, reference
to authoritative published DeepSeek benchmark data, a locally verifiable baseline
registry, and a measurable improvement in real DeepSeek use efficiency.

All evidence must be reproducible, machine-readable, and tied to a specific application
revision, canonical model, protocol, provider, fixture, seed, and run date. Skipped,
blocked, timed-out, flaky, or manually waived cases do not count as passed.

## Cross-Platform Smoke

The release matrix builds the CLI TUI artifact on native macOS, Linux, and Windows
runners. On each platform the packaged artifact must launch, open a clean workspace,
connect through a test DeepSeek provider, execute a smoke task, and produce a completion
event and evidence record.

The smoke test is the minimum gate, not the full acceptance suite.

## AI Persona End-to-End Matrix

The E2E matrix uses seeded AI user simulators backed by DeepSeek models. A simulator
receives a persona definition, a goal, constraints, communication style, and a stopping
condition. It cannot see evaluator-only assertions. A separate evaluator session scores
quality and checks the evidence; the simulated user never judges its own session.

The minimum persona matrix is:

- Novice developer who needs guidance and avoids jargon.
- Senior backend engineer optimizing a production service.
- Frontend engineer working on a design system.
- DevOps/SRE operator working with terminals and incident runbooks.
- Data engineer modifying a pipeline or analysis.
- Security auditor testing unsafe actions and secret handling.
- QA engineer constructing reproducible bug reports.
- Product-minded founder prioritizing scope and speed.
- Accessibility-first user requiring clear terminal interaction.
- Terse expert who supplies minimal context and expects concise responses.
- Non-native English/Chinese user mixing languages and ambiguous shorthand.
- Adversarial user testing scope creep, approval bypass, and misleading instructions.

Each persona runs on the CLI TUI on macOS, Linux, and Windows. This produces at least 36
persona scenarios (`12 x 3`). Every scenario has deterministic functional assertions for
task completion, workspace safety, approval behavior, session persistence, and evidence
quality. A separate rubric covers clarity, responsiveness, and recovery from ambiguity.
All deterministic assertions must pass, with no P0 or P1 defect.

Persona fixtures are versioned and reviewed for coverage. Persona text may vary through
seeded generation, but its goals, constraints, invariants, and acceptance assertions are
stable across runs.

## External Baseline Snapshot

Model-quality evidence comes from authoritative published sources rather than a
self-constructed benchmark baseline. Acceptable sources are:

- DeepSeek's official model announcement, technical report, or published benchmark
  tables.
- An official benchmark publisher's leaderboard for the same benchmark version.
- A reputable aggregated leaderboard that publishes its source set and methodology.

The selected source set is stored as an immutable snapshot containing the publisher,
source URL, benchmark/model version, retrieval date, raw values, units, and a SHA-256
hash of the normalized data. If a source omits `deepseek-flash` or publishes no
comparable aggregate, that source is marked unavailable; NeonForge does not fill the gap
with a self-run baseline.

The snapshot is reference data. NeonForge does not claim to reproduce the publisher's
machines, harness environment, sampling configuration, or private judge, and
documentation must label the values as external.

## Local Baseline Registry

Confirmed benchmark suites, official model data, and evaluation methods are stored
locally under `benchmarks/` so verification does not depend on live network access.

The registry is indexed by `benchmarks/registry.json`. Each confirmed entry records:

- Stable suite ID, kind, publisher, canonical model, benchmark version, and retrieval
  date.
- Source URLs and locally stored raw source files.
- License/redistribution notes or a pointer to the publisher's terms.
- Method, task-count, scoring rule, effort setting, run count, and aggregation rule.
- Normalized values, units, availability status, and SHA-256 integrity hash.
- Adapter path when the suite is executable by NeonForge.

V1 must include the DeepSeek official baseline, a Bug Hunt Bench snapshot, and a Bug Hunt
Bench adapter contract covering the two repository prompts, task manifest, harness
invocation, `BUGS_FOUND.md` evidence, blind-scoring boundary, and expected result schema.
V1 does not run Bug Hunt Bench and does not claim a NeonForge harness score.

The local store must support an offline verification command that checks the registry
schema, source-file presence, hashes, normalized-value hashes, and canonical promotion
state. Unconfirmed sources remain staged and cannot be cited as accepted evidence.
Additional authoritative suites and methods are collected during delivery, reviewed, and
added only after provenance is complete; unsuitable or unavailable candidates remain
recorded with reasons.

The V2 Final Delivery Shape extends this section with the measured Bug Hunt Bench
comparison: NeonForge + DeepSeek V4.1 Flash 1017, high effort, 5 attempts per task,
3 hours per repository, blind grading, target at least 40.4 fixed/105.

## Model-Quality Acceptance

The pass rule is:

- 100% pass for deterministic NeonForge protocol, conformance, and E2E tests.
- The external baseline snapshot is complete for every source claimed in the release
  documentation, and each cited value maps to its source with no local substitution.
- The local baseline registry is internally consistent, offline-verifiable, and contains
  all confirmed suites, official data, methods, raw source files, and hashes referenced
  by release documentation.
- Published values are presented exactly as published, including benchmark version,
  model version, aggregation method, and date.
- Product claims do not imply that local NeonForge runs reproduced the external
  environment or the publisher's score.

## Efficiency A/B Test

The optimized NeonForge runtime is compared with an unoptimized reference baseline on
the same frozen task mix, canonical model, protocol, provider, permission mode, fixtures,
and seeds.

The primary metric is real-use cost per successful task. Guardrail metrics are:

- Task success rate.
- Median and p95 wall-clock time.
- Input, output, and reasoning tokens.
- Cache-hit and cache-miss tokens.
- Tool calls and model turns.
- User interventions.
- Error and retry rate.

The acceptance thresholds are at least 15% lower cost per successful task and 10% lower
median wall-clock time, with no more than a 2 percentage-point regression in success
rate. The report must include paired samples, medians, confidence intervals, and enough
raw data to reproduce the calculation.

## Evidence and Reproducibility

- Every report names the git revision, application version, model version, protocol,
  provider, external-baseline snapshot hash, persona fixture hash, seed, and run
  timestamps.
- Every confirmed baseline names its local registry ID, raw source path, normalized-data
  hash, retrieval date, and license/redistribution status.
- Credentials and secret-bearing headers are absent from reports.
- Failed runs preserve logs and diagnostics and are reported, not retried until they
  disappear.
- Repeated runs use the same frozen inputs; stochastic variation is reported rather than
  hidden by selecting the best run.
- The release fails if any required suite has a skipped, blocked, timed-out, or flaky
  required case, or if the efficiency thresholds are not met.

## Scenarios

### Scenario: Full AI persona E2E

The AI persona suite runs all 12 personas on the CLI TUI on macOS, Linux, and Windows.
All 36 scenarios pass their deterministic functional assertions, no P0/P1 defect is
found, and independent evaluator evidence is recorded for each scenario.

Acceptance: A16

### Scenario: Authoritative external baseline

The release contains an immutable external-baseline snapshot for `deepseek-flash` with
publisher, source URL, benchmark and model version, retrieval date, raw values, units,
aggregation method, and integrity hash. Every model-quality claim maps to that snapshot;
no self-generated baseline is presented as third-party evidence, and unavailable
sources are explicitly marked.

Acceptance: A17

### Scenario: Real-use efficiency improvement

Paired optimized and unoptimized runs use identical tasks, model, protocol, permissions,
fixtures, and seeds. The optimized runtime meets the confirmed cost and wall-clock
thresholds without exceeding the confirmed success-rate regression margin, and the
report includes reproducible per-run evidence.

Acceptance: A18

### Scenario: Confirmed local baseline registry

The repository contains a versioned local registry for confirmed authoritative suites
and official data. It includes the DeepSeek official baseline and a Bug Hunt Bench
snapshot plus adapter contract. Offline verification validates every source file, hash,
method, retrieval record, and canonical status. Staged or unavailable sources are never
treated as accepted evidence. V1 does not claim a NeonForge Bug Hunt Bench score.

Acceptance: A19
