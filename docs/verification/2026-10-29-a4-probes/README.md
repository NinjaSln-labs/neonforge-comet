# Independent Verifier Probe Archive (2026-10-29)

These files preserve the independent A4 probes that drove the DeepSeek response-model
repair for V1 Foundation. They lived under `/tmp` during the run, which is volatile on
reboot, so the durable copies are recorded here.

- `verifier-59/` - first independent Verifier: found the A4 defect (a provider could
  answer a DeepSeek request with `gpt-4.1` and the adapters accepted it).
- `verifier-62/` - second Verifier: probed the repaired adapters in both streaming and
  buffered modes and passed 19/19.
- `verifier-69/` - third Verifier: re-probed the same repair after the check-input drift
  correction and passed 19/19.

The probe scripts are self-contained: each imports the adapters and
`tests/helpers/mock-provider.ts` from the repository, starts a local mock provider, and
asserts the policy outcome. Re-run with
`node --experimental-strip-types <script>` from the repository root.

Runtime request/response envelopes (claim tokens, outcome ids, status snapshots) are
intentionally excluded: Comet keeps dispatch requests out of artifacts, and the
authoritative verification record lives in
`docs/comet/archive/2026-10-28-neonforge-foundation/verification.md`.
