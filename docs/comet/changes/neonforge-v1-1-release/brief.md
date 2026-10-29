# Outcome

V1.1 release readiness is complete enough to publish: Windows users can store provider
credentials in Credential Manager; every installer carries the MIT license and
third-party notices; release evidence uses portable paths; and a documented native-host
job rebuilds, aggregates, verifies, and attests the complete release evidence bundle.

The release bundle must be independently verifiable offline from its own hashes and
must never claim macOS or Windows evidence that was not produced on the corresponding
native runner.

# Scope

## Directory structure

### Created

- `scripts/release/assemble-evidence.mjs` - collect the platform evidence and installers,
  reject stale or missing inputs, and write a deterministic bundle manifest and checksum
  index.
- `scripts/release/verify-evidence-bundle.mjs` - verify bundle schema, source revision,
  required platform coverage, file sizes, legal files, and SHA-256 hashes without network
  or provider access.
- `tests/release-evidence.test.ts` - cover successful assembly, missing/stale platform
  evidence, tampered hashes, and offline bundle verification.
- `docs/release/evidence-reproduction.md` - document native-host prerequisites, provider
  secrets, workflow dispatch/tag usage, local reproduction, verification, and bundle
  limitations.
- `.github/workflows/release-evidence.yml` - build and test on native macOS, Linux, and
  Windows runners, aggregate all required evidence, verify it, produce checksums, and
  attest the bundle with GitHub artifact provenance.

### Modified

- `packages/config/src/index.ts` - keep the Windows Credential Manager implementation
  that passes secrets over stdin and never through argv.
- `tests/security-config.test.ts` - cover the Windows Credential Manager command boundary
  and argument redaction.
- `scripts/e2e/run-personas.mjs` - keep repository-relative persona report references.
- `scripts/release/build.mjs` - keep relative artifact evidence and require `LICENSE` and
  `THIRD_PARTY_NOTICES` in every installer.
- `scripts/release/write-source-manifest.mjs` - bind the legal files into the source
  revision.
- `scripts/release/check-evidence.mjs` - validate evidence from the assembled bundle
  layout while retaining the existing offline acceptance checks.
- `.github/workflows/release.yml` - upload enough platform output for evidence assembly
  and publication.
- `package.json` - add bundle assembly, offline verification, and reproduction commands.
- `README.md` - link the V1.1 release evidence procedure and MIT licensing.
- `LICENSE` and `THIRD_PARTY_NOTICES` - distribute the selected MIT license and accurate
  build-time notices.
- `docs/product/known-issues.md` - record K1, K2, K3, and K8 resolution or the precise
  remaining publication condition.

### Not created

- A private signing key or hosted evidence service - GitHub artifact provenance provides
  signed workflow identity without introducing a new key-management dependency.
- A separate evidence database - versioned JSON manifests and SHA-256 sidecars are enough
  for offline verification and release attachment.

# Non-goals

- Running the V2 Desktop application or the measured Bug Hunt Bench comparison.
- Bundling Node.js, model weights, a browser engine, or provider credentials.
- Treating a workflow definition or a Linux-only run as proof of native macOS or Windows
  execution.
- Pushing a branch, creating a tag, publishing a release, or creating a PR without
  separate authorization.

# Acceptance examples

- A1: On Windows, adding a provider stores the API key in Credential Manager and reading
  the provider retrieves the same value; the key never appears in process arguments,
  logs, session events, or exports.
- A2: Every generated installer contains a valid MIT `LICENSE`, accurate
  `THIRD_PARTY_NOTICES`, and package metadata declaring `MIT`; the build fails when a
  legal file is absent or omitted from the archive.
- A3: Persona smoke and release evidence contain only repository-relative artifact paths,
  and offline validation rejects any evidence whose recorded source revision differs
  from the current source manifest.
- A4: `pnpm evidence:assemble` accepts complete native-platform inputs, writes a
  deterministic bundle manifest listing every required file with its SHA-256 hash and
  byte size, and rejects missing, duplicate, stale, or wrong-platform evidence.
- A5: `pnpm evidence:verify <bundle>` verifies the bundle offline, including schema,
  source revision, all required platforms and protocols, installer size and legal files,
  manifest hashes, and checksum sidecar, without reading provider credentials or using
  the network.
- A6: The native release-evidence workflow runs the required build, test, protocol, persona,
  and A/B gates on their assigned runners, publishes the aggregated bundle, and attests
  its provenance; it never combines artifacts from different source revisions.
- A7: `docs/release/evidence-reproduction.md` documents the exact commands, required
  secrets and hosts, artifact retention, verification result, and the fact that a bundle
  proves recorded workflow provenance rather than reproducibility of the publisher's
  external benchmark environment.

# Constraints and invariants

- No provider secret or credential-bearing header may appear in a bundle, manifest,
  checksum file, workflow output, or terminal log.
- macOS evidence must come from macOS, Windows evidence from Windows, and Linux evidence
  from Linux.
- All required evidence must bind to one `source-manifest.json` revision and one Git
  commit.
- Bundle verification must work offline and must fail closed when any required file,
  hash, platform, or legal document is missing.
- Existing V1 behavior and acceptance remain unchanged outside the confirmed V1.1 scope.

# Decisions

- License: MIT, copyright 2026 NinjaSln.
- Windows secrets: Windows Credential Manager through `advapi32.dll`, with secret input
  over stdin and an encoded PowerShell command that contains no secret.
- K3 evidence delivery: use GitHub artifact provenance plus a reproducible native-host CI
  workflow. No separately managed signing key is introduced.
