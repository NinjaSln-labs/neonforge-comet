# NeonForge Known Issues Backlog

Status: accepted for V1 Foundation delivery on 2026-10-29; K1, K2, K3, and K8 were
resolved by the V1.1 release-readiness change.
Owner decision: ship V1 with these items recorded here instead of fixing them in this
change.

The V1 Foundation acceptance criteria are unaffected: all 19 items passed independent
verification on candidate `0d31d401643dd21b70cc843d1763b4b870be50eee269c329302b6549990a19f3`
at source revision `fae019514a3fbb9cf3918ca9357249a1b51c7395d7ff11d0a60f7dda2fc2b3b2`.

## Resolved after the V1 archive

| ID | Area | Resolution |
| --- | --- | --- |
| K1 | Windows | `storeSecret`/`readSecret` use Windows Credential Manager through `advapi32.dll`. `provider add` rejects `--api-key` and accepts piped `--api-key-stdin`; the secret never crosses NeonForge or PowerShell argv. Unit coverage mocks the platform boundary, and a live WSL-to-Windows smoke verified write/read with a random credential before deleting it. |
| K2 | Packaging | NeonForge is licensed under MIT. `LICENSE` and `THIRD_PARTY_NOTICES` are included in the package metadata, source revision, release evidence, and every installer; packaging fails if either file is missing from the archive. |
| K3 | Evidence | A native macOS/Linux/Windows workflow rebuilds all evidence, aggregates one source-revision-bound bundle, verifies it offline, and attests the archive with GitHub artifact provenance. The release workflow attaches the bundle and checksums to a tag release. |
| K8 | Evidence hygiene | Persona smoke records and release evidence now write repository-relative `dist/` paths instead of absolute build-host paths. |

## Delivery blockers to resolve before public release

No open delivery blockers remain. A real release still requires an authorized remote run
of the native evidence workflow with provider secrets; the absence of a configured Git
remote is an external publication prerequisite, not a product defect.

## Accepted technical risks

| ID | Severity | Area | Issue | Why accepted |
| --- | --- | --- | --- | --- |
| K4 | Medium | Benchmarks | A/B cost reduction is -80.9% (CI95 76.4%-84.7%) and median wall time is -19.3% (CI95 7.0%-41.4%). The time point estimate clears the 10% threshold but its lower bound does not; the sample is 12 paired runs over 6 tasks. | Thresholds were confirmed against the observed median; widening the sample needs more provider budget and is scheduled for V2. |
| K5 | Medium | Provider evidence | Protocol smoke and A/B ran against a Magpie-compatible DeepSeek gateway (`127.0.0.1:3425`), not `api.deepseek.com` directly. | The official endpoint uses the same configuration path and was inspected, but not exercised end-to-end. |
| K6 | Medium | Model policy | The response-side guard rejects any provider model name outside the DeepSeek family. A vendor that echoes an opaque endpoint id (for example `ep-xxxx`) is refused. | This is the intended strict reading of "DeepSeek family only"; the `canonical-model` override was deferred by product decision. |
| K7 | Low | Cross-platform verification | macOS and Windows persona reports were produced on those hosts, but the independent Verifier ran on Linux and hash-checked them rather than rerunning them. | Both reports contain 12/12 passing scenarios bound to the same revision; reruns need two extra hosts per verification round. |
| K9 | Low | Baseline registry | License and redistribution rationale lives in `benchmarks/sources/README.md` rather than in structured fields on every registry entry. | Documentary today; V2 should add `license` and `redistribution` fields per source. |
| K10 | Low | Reporting | The Comet-generated `docs/comet/changes/neonforge-foundation/verification.md` lists the A18/A19 headings in the opposite order from the formal spec. | Comet owns that report; the formal mapping (A18 efficiency, A19 registry) is authoritative and the submitted reasons follow it. |

## Deferred scope

| ID | Scope | Note |
| --- | --- | --- |
| K11 | Desktop app | V1 ships CLI TUI and headless NDJSON only; Desktop is a V2 Final Delivery requirement. |
| K12 | Bug Hunt Bench score | V1 stores the snapshot, method and adapter contract but does not run the suite or claim a score. V2 target is at least 40.4 fixed/105 under the publisher's blind judge, 5 attempts, 3 hours per repository. |
| K13 | Nine-harness table | The high-effort comparison table comes from a cited secondary article/X post; the current official README exposes only four high-effort DeepSeek rows. Both snapshots are stored locally and labelled. |
