import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const adapterPath = resolve(root, "benchmarks/adapters/bug-hunt-bench/adapter.json");
const adapter = JSON.parse(readFileSync(adapterPath, "utf8"));
const errors = [];

if (adapter.schema !== "neonforge.benchmark-adapter.v1") {
  errors.push("adapter schema is invalid");
}
if (adapter.taskCount !== 105) errors.push("task count must be 105");
if (adapter.effort !== "high") errors.push("effort must be high");
if (adapter.runPolicy?.attemptsPerTask !== 5) {
  errors.push("attempts per task must be 5");
}
if (adapter.runPolicy?.timeLimitSecondsPerRepository !== 10800) {
  errors.push("time limit must be 10800 seconds per repository");
}
if (adapter.runPolicy?.network !== false) errors.push("network must be disabled");
if (adapter.runPolicy?.gitHistory !== false) errors.push("git history must be disabled");
if (adapter.scoringContract?.neonForgeMayNotSelfScore !== true) {
  errors.push("adapter must require independent blind scoring");
}
if (adapter.v1Boundary?.scoreClaim !== null) {
  errors.push("V1 must not claim a Bug Hunt Bench score");
}

for (const repository of adapter.repositories ?? []) {
  const prompt = resolve(root, repository.promptFile);
  if (!existsSync(prompt)) {
    errors.push(`${repository.id} prompt is missing: ${repository.promptFile}`);
  }
}

if (!existsSync(resolve(root, adapter.sourceSnapshot))) {
  errors.push(`source snapshot is missing: ${adapter.sourceSnapshot}`);
}

if (errors.length) {
  console.error(errors.map((error) => `FAIL: ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  `PASS: bug-hunt-bench contract validated (${adapter.taskCount} bugs, ` +
    `${adapter.repositories.length} repos, ${adapter.runPolicy.attemptsPerTask} attempts, ` +
    `${adapter.runPolicy.timeLimitSecondsPerRepository}s/repo, V2 target ${adapter.v2Target.fixed}).`
);
