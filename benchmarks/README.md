# Benchmarks

`external-baseline.json` is an immutable snapshot of authoritative published DeepSeek
model information. It is reference data only; NeonForge does not claim to reproduce the
publisher's environment.

The V1 efficiency gate compares NeonForge's optimized runtime with an unoptimized
baseline using the same frozen task mix, model, protocol, provider, permissions, fixtures,
and seeds. The primary metric is cost per successful task; guardrails are success rate,
median and p95 wall-clock time, input/output/reasoning tokens, cache hit/miss, tool calls,
model turns, user interventions, and error/retry rate.

Acceptance thresholds:

- At least 15% lower cost per successful task.
- At least 10% lower median wall-clock time.
- No more than a 2 percentage-point success-rate regression.

The full A/B run requires a configured DeepSeek provider and the budget documented in
the V1 Shape. Results must be stored as machine-readable reports with raw per-run data.
