---
generated_from_state_version: 21
---

# Verification

## Current result

- Result: **Archived**
- Verification status: **Checks completed; result confirmed**
- Goal cycle: 1
- Iteration: 5
- Verifier attempt: 1
- Completed: 2026-10-29T09:11:28.098Z
- Summary: Independent verification of candidate 123c1006 supports A1-A7. The current 19-file archive is attested by run 40845662012 and passes offline verification; source, focused probes, the native Linux/Intel macOS/Windows workflow jobs, deterministic assembly, stale and duplicate rejection, legal installer contents, and the documented v1.1.0 release verification all match their acceptance criteria.

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1: On Windows, adding a provider stores the API key in Credential Manager and reading the provider retrieves the same value; the key never appears in process arguments, logs, session events, or exports. | providerSecretForAdd rejects --api-key before any provider/config write and accepts only non-TTY stdin for --api-key-stdin. An independent CLI probe exited 2 with no config; a piped-key probe through a fake secret-tool observed the key on stdin, never in secret-tool argv, and config contained only apiKeyRef neonforge:probe. The Windows path sends the secret as JSON stdin to an encoded PowerShell command using CredWriteW/CredReadW, and the native Windows job ran the focused Credential Manager boundary/read tests with 0 failures. Source review found no API key in session records, events, or exports. |
| A2 | passed | brief.md | A2: Every generated installer contains a valid MIT `LICENSE`, accurate `THIRD_PARTY_NOTICES`, and package metadata declaring `MIT`; the build fails when a legal file is absent or omitted from the archive. | scripts/release/build.mjs requires and copies LICENSE and THIRD_PARTY_NOTICES, then verifies both archive entries. Independent temporary build probes exited 1 with the exact missing-LICENSE and missing-THIRD_PARTY_NOTICES errors. The current bundle's Linux, Darwin, and Windows installers all declare MIT and contain LICENSE and THIRD_PARTY_NOTICES byte-identical to the repository; all are below 50 MB. Focused assembly tests also reject an installer without the notices. |
| A3 | passed | brief.md | A3: Persona smoke and release evidence contain only repository-relative artifact paths, and offline validation rejects any evidence whose recorded source revision differs from the current source manifest. | The current bundle's personaReport values are dist/e2e/... and release-artifact values are dist/installers/..., with no absolute paths, and every evidence record uses revision 074f4ee43706. After changing a smoke record to a different revision and recomputing all hashes and SHA256SUMS, evidence:verify still exited 1 with a stale-revision error, proving revision binding is independent of hash validity. |
| A4 | passed | brief.md | A4: `pnpm evidence:assemble` accepts complete native-platform inputs, writes a deterministic bundle manifest listing every required file with its SHA-256 hash and byte size, and rejects missing, duplicate, stale, or wrong-platform evidence. | The current complete 19-file native inputs assembled twice with SOURCE_DATE_EPOCH=1790000000; bundle.json, SHA256SUMS, and the resulting archive were byte-identical across runs, manifest entries were sorted and covered all files with SHA-256 and byte size, and sha256sum -c passed. Adding a byte-identical protocol-smoke/openai-chat-copy.json made the actual evidence:assemble CLI exit 1 with Unexpected evidence file and created no output. Focused tests cover missing and wrong-platform rejection. |
| A5 | passed | brief.md | A5: `pnpm evidence:verify <bundle>` verifies the bundle offline, including schema, source revision, all required platforms and protocols, installer size and legal files, manifest hashes, and checksum sidecar, without reading provider credentials or using the network. | The release-evidence artifact downloaded from run 40845662012 has SHA-256 a4b27e43407fd1764f45b04102ce238de4e9a5a00432eff9487af7c9bec9ecd9 and matches the supplied local copy. evidence:verify passed for both the archive and extracted directory, reporting revision 074f4ee43706, commit ccb3a588bf1a, 19 files, linux/darwin/windows, and all three protocols; SHA256SUMS validated all 20 entries. The same command passed inside a bwrap network namespace with a clean HOME and no provider credentials, and source inspection found no network or credential-reading path. |
| A6 | passed | brief.md | A6: The native release-evidence workflow runs the required build, test, protocol, persona, and A/B gates on their assigned runners, publishes the aggregated bundle, and attests its provenance; it never combines artifacts from different source revisions. | Run 40845662012 succeeded at ccb3a58. Its native-linux, native-darwin on a macos-15-intel x64 runner, and native-windows jobs all completed the required privacy, typecheck, test, build, protocol-smoke, and persona steps; Linux's paired A/B step also succeeded. The aggregate job assembled and verified revision 074f4ee43706, generated and uploaded the bundle, and actions/attest-build-provenance@v3 succeeded. gh attestation verify passed when constrained to release-evidence.yml, refs/heads/main, commit ccb3a58, and subject digest a4b27e43..., with invocationId run 40845662012/attempts/1. The prior v1.1.0 run 40842737239 also succeeded and published an attested archive in the GitHub release. |
| A7 | passed | brief.md | A7: `docs/release/evidence-reproduction.md` documents the exact commands, required secrets and hosts, artifact retention, verification result, and the fact that a bundle proves recorded workflow provenance rather than reproducibility of the publisher's external benchmark environment. | docs/release/evidence-reproduction.md lines 53-71 now contain the Published Verification Result with the v1.1.0 run 40842737239, commit a29bf8d, release link, archive name, source revision 7e4c400c2aa5, published SHA-256 40d43f75..., exact offline verify command and result, and attestation scope. Independently, the release asset digest matched that SHA, the tag run and all native/aggregate jobs succeeded, evidence:verify passed against a clean clone at a29bf8d, and gh attestation verify passed for refs/tags/v1.1.0 and the same archive digest. The document also states the required hosts/secrets/retention and the provenance-versus-external-benchmark boundary. |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| Unit and integration tests | test | . | passed | 0 | 2552 ms |
| Public tree privacy scan | privacy:check | . | passed | 0 | 159 ms |
| Build current-platform installer | build:custom | . | passed | 0 | 206 ms |
| Installer size and release metadata | release:check | . | passed | 0 | 113 ms |
| Offline baseline registry verification | baseline:verify | . | passed | 0 | 187 ms |
| Bug Hunt Bench adapter contract | baseline:adapter | . | passed | 0 | 114 ms |

### Builder-reported evidence

These are Builder reports, not Runtime check receipts or independent verification results.

- unit-and-integration-tests: passed — pnpm test passed 51/51.
- privacy-scan: passed — pnpm privacy:check passed for 138 public-tree files.
- native-evidence-workflow: passed — Run 40845662012 passed Linux, Intel macOS, Windows, aggregate, and attestation jobs.
- offline-bundle-verification: passed — New archive verified offline with 19 files, three platforms, and three protocols.
- artifact-attestation: passed — gh attestation verify passed for commit ccb3a58 under refs/heads/main.
- published-result-documentation: passed — docs/release/evidence-reproduction.md now contains the actual v1.1.0 run, revision, digest, verification, and attestation result.
- Known limitation: Windows Credential Manager store/read remains covered by unit tests and the native Windows CI suite, not a native interactive NeonForge session.
- Known limitation: The A/B result is a single paired run on one DeepSeek provider/model; it does not reproduce an external publisher environment.
- Known limitation: The application package version remains 0.1.0 while the published release tag is v1.1.0.

## Blockers

_None._

## Risks and skipped work

- This Linux verifier did not exercise an interactive Windows Credential Manager store/read operation directly; A1 is supported by the Windows implementation, focused boundary/read tests in the native Windows CI job, and independent Linux-side argv/stdin/config probes.
- The A/B acceptance evidence is one paired Linux run. The workflow gate passed, but it does not reproduce an external publisher's benchmark environment.
- The durable v1.1.0 release attachment is bound to commit a29bf8d and revision 7e4c400c2aa5; the repaired ccb3a58/074f4ee43706 evidence is an attested GitHub workflow artifact, not a replacement release asset.

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 0 | recovery | — | Runtime checks completed, but their input changed before acceptance. Preserve the original receipts and approve a new Builder candidate; do not replay the old checks. | 2026-10-29T07:23:43.364Z |
| 1 | 1 | 0 | recovery | — | The user chose to repair the implementation after Runtime checks stopped. | 2026-10-29T07:24:48.238Z |
| 1 | 2 | 1 | fail | A1, A4, A6 | Independent verification found two defects: the CLI exposes the provider key in NeonForge process arguments before the secure PowerShell boundary (A1), and evidence:assemble does not reject extra duplicate input evidence (A4). A2/A3/A5/A7 are supported by source, tests, receipts, and read-only probes. A6 is implemented in workflow YAML but execution, publication, and attestation are blocked by the absence of a remote workflow run and attestation evidence. | 2026-10-29T07:33:56.798Z |
| 1 | 3 | 1 | blocked | A6 | Independent verification of candidate 1a9ac031 found the prior A1 argv-secret and A4 duplicate-input defects repaired by direct CLI probes and focused tests. A1-A5 and A7 are supported. The overall verdict is blocked because A6 has no executed remote native workflow or artifact provenance attestation. | 2026-10-29T07:46:17.536Z |
| 1 | 3 | 1 | recovery | — | The user chose to revise the implementation after Verify stopped. | 2026-10-29T08:31:53.755Z |
| 1 | 4 | 1 | fail | A7 | Independent verification found A1-A6 supported by source, tests, native workflow runs, the released 19-file bundle, its SHA-256 digest, offline verification, and GitHub attestation. A7 fails because the required reproduction document does not record an actual verification result for the released bundle. Overall verdict: fail. | 2026-10-29T08:52:42.023Z |
| 1 | 5 | 1 | pass | — | Independent verification of candidate 123c1006 supports A1-A7. The current 19-file archive is attested by run 40845662012 and passes offline verification; source, focused probes, the native Linux/Intel macOS/Windows workflow jobs, deterministic assembly, stale and duplicate rejection, legal installer contents, and the documented v1.1.0 release verification all match their acceptance criteria. | 2026-10-29T09:11:28.098Z |



## Conclusion

Independent verification of candidate 123c1006 supports A1-A7. The current 19-file archive is attested by run 40845662012 and passes offline verification; source, focused probes, the native Linux/Intel macOS/Windows workflow jobs, deterministic assembly, stale and duplicate rejection, legal installer contents, and the documented v1.1.0 release verification all match their acceptance criteria.
