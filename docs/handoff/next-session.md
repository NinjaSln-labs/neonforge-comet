# Next Session Handoff

Written 2026-10-29 when V1 Foundation was archived and the session was closed.

## Where things stand

- Repo: `/workspace/neonforge-comet` (worktree clean at handoff)
- Comet Native change `neonforge-foundation`: archived to
  `docs/comet/archive/2026-10-28-neonforge-foundation/`, Run `completed`, no active change
- Git: `eaf1c2d` baseline (tag `baseline/v1-foundation`) -> `aeb2bdf` V1 delivery with the
  A4 response-model repair -> `10f9b9f` verifier probes
- Verification of record: candidate `45313275`, 19/19 accepted, source revision
  `fae019514a3fbb9cf3918ca9357249a1b51c7395d7ff11d0a60f7dda2fc2b3b2`
- Evidence: 36/36 persona E2E (Linux/macOS/Windows), 36/36 tests on Linux and macOS
  (Windows 35 + 1 POSIX-only skip), 3/3 protocol smokes, A/B 12 pairs (cost -80.9%,
  median time -19.3%, 12/12 vs 11/12), installers 22,143 / 22,190 / 22,220 bytes

## Read first

1. `docs/product/known-issues.md` - K1-K13, including the two public-release blockers
2. `docs/comet/specs/` - published capability specs
3. `docs/comet/archive/2026-10-28-neonforge-foundation/verification.md` - final verdict
4. `docs/verification/2026-10-29-a4-probes/README.md` - how A4 was found and fixed

## Suggested next work

1. V1.1 release readiness: K1 Windows secret storage, K2 MIT packaging, K3 reproducible
   attested evidence, and K8 portable evidence paths are implemented. Run the native
   release-evidence workflow on an authorized remote with provider secrets before
   publishing.
2. V2 Final Delivery: Desktop app, direct `api.deepseek.com` provider evidence, and a
   measured Bug Hunt Bench run targeting at least 40.4 fixed/105 under the publisher's
   blind judge (5 attempts, 3 hours per repository).

## Before starting work

- `pnpm test` and `pnpm verify:evidence` should both pass offline on this machine only if
  `dist/` still exists. It is gitignored build output; regenerate with `pnpm build`,
  `test:personas`, `smoke:protocols`, `benchmark:ab`, `build:custom` when it is missing,
  which needs real provider access plus macOS and Windows hosts.
- No Git remote is configured. Push, PR creation, and any new remote still need explicit
  user authorization.
- Comet has no active change. Start the next one with the Comet Native workflow instead of
  reusing the archived change.
