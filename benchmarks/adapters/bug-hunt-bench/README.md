# Bug Hunt Bench Adapter

This adapter freezes the contract needed to run NeonForge against Bug Hunt Bench. V1
validates the local source snapshot, prompts, task counts, run policy, and scoring
boundary. It does not run the benchmark or claim a score.

V2 Final Delivery runs NeonForge + DeepSeek V4.1 Flash 1017 at high effort, five attempts
per task, three hours per repository, against the same two repository prompts and blind
judge. The target is at least 40.4 fixed/105.

Required repository paths:

- `NEONFORGE_BUG_HUNT_REPO1`
- `NEONFORGE_BUG_HUNT_REPO2`

The answer key is withheld by the benchmark publisher. NeonForge must not self-score,
invent an answer key, or present a run as official without the publisher's blind judge.

Validate the local snapshot and adapter:

```sh
node scripts/benchmarks/bug-hunt-bench.mjs --validate
```
