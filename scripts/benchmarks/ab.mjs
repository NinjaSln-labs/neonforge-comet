import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceRevision } from "../lib/source-revision.mjs";

if (
  !process.env.OPENAI_BASE_URL ||
  !process.env.OPENAI_API_KEY ||
  !process.env.OPENAI_MODEL
) {
  console.error("Set OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL first.");
  process.exit(2);
}

const threshold = {
  costReduction: 0.15,
  timeReduction: 0.1,
  successRegressionPoints: 2
};
const repetitions = positiveInteger(process.env.NEONFORGE_AB_REPS ?? "2", 2);
const seedBase = positiveInteger(process.env.NEONFORGE_AB_SEED ?? "20261028", 20261028);
const tasks = [
  task("release-note", "RESULT_RELEASE_NOTE_7F3A"),
  task("migration-checklist", "RESULT_MIGRATION_CHECKLIST_91C2"),
  task("test-plan", "RESULT_TEST_PLAN_A64D"),
  task("security-note", "RESULT_SECURITY_NOTE_3E88"),
  task("incident-summary", "RESULT_INCIDENT_SUMMARY_B205"),
  task("api-contract", "RESULT_API_CONTRACT_5D17")
];
const stableContext = Array.from(
  { length: 400 },
  (_, index) =>
    `Workspace rule ${index + 1}: preserve the selected workspace boundary, record artifact evidence, ` +
    `prefer deterministic tool sequences, and never run shell commands unless the user explicitly asks.`
).join("\n");
const arms = {
  optimized: {
    env: {},
    args: [],
    description:
      "Adaptive low effort for routine tasks, stable cacheable prefix, automatic workspace write approval."
  },
  baseline: {
    env: { NEONFORGE_DISABLE_OPTIMIZATIONS: "1" },
    args: ["--thinking", "high"],
    description:
      "Unoptimized reference: per-request prefix nonce, no cache stability, high reasoning effort."
  }
};

const pairs = [];
for (let repetition = 0; repetition < repetitions; repetition += 1) {
  for (const [taskIndex, taskDefinition] of tasks.entries()) {
    const seed = seedBase + taskIndex * 100 + repetition;
    const order =
      (taskIndex + repetition) % 2 === 0
        ? ["optimized", "baseline"]
        : ["baseline", "optimized"];
    const measured = {};
    for (const armName of order) {
      measured[armName] = await runTask(taskDefinition, armName, seed);
    }
    const pair = {
      taskId: taskDefinition.id,
      repetition,
      seed,
      optimized: measured.optimized,
      baseline: measured.baseline
    };
    pairs.push(pair);
    console.log(
      `${taskDefinition.id}#${repetition}\t` +
        `opt=${measured.optimized.wallMs}ms/${measured.optimized.success ? "PASS" : "FAIL"}\t` +
        `base=${measured.baseline.wallMs}ms/${measured.baseline.success ? "PASS" : "FAIL"}`
    );
  }
}

const report = buildReport(pairs);
const outputDir = join(process.cwd(), "dist", "benchmarks");
mkdirSync(outputDir, { recursive: true });
const output = join(outputDir, "ab.json");
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Wrote ${output}`);
if (
  report.summary.costReduction < threshold.costReduction ||
  report.summary.timeReduction < threshold.timeReduction ||
  report.summary.successRegressionPoints > threshold.successRegressionPoints
) {
  process.exit(1);
}

async function runTask(taskDefinition, armName, seed) {
  const arm = arms[armName];
  const home = mkdtempSync(join(tmpdir(), `neonforge-ab-home-${armName}-`));
  const workspace = mkdtempSync(join(tmpdir(), `neonforge-ab-work-${armName}-`));
  cpSync(join(process.cwd(), "tests", "fixtures", "e2e-workspace"), workspace, {
    recursive: true
  });
  writeFileSync(
    join(workspace, "benchmark-context.txt"),
    `${taskDefinition.id}\n${taskDefinition.token}\n`
  );
  const startedAt = Date.now();
  const run = await runCli(
    [
      "dist/neonforge.mjs",
      "run",
      taskDefinition.prompt,
      "--workspace",
      workspace,
      "--permission",
      "workspace-auto",
      "--json",
      "--seed",
      String(seed),
      ...arm.args
    ],
    {
      ...process.env,
      ...arm.env,
      NEONFORGE_HOME: home,
      NEONFORGE_STABLE_CONTEXT: stableContext
    }
  );
  const wallMs = Date.now() - startedAt;
  const parsed = parseResult(run.stdout);
  const session = parsed?.session;
  const events = readEvents(home, session?.id);
  const filePath = join(workspace, taskDefinition.file);
  const content = existsSync(filePath) ? readFileSync(filePath, "utf8").trim() : "";
  const toolCalls = events.filter((event) => event.kind === "tool.completed").length;
  const modelTurns = events.filter(
    (event) => event.kind === "model.completed"
  ).length;
  const userInterventions = events.filter(
    (event) =>
      event.kind === "approval.decided" && event.data.automatic !== true
  ).length;
  const errors = events.filter(
    (event) =>
      event.kind === "tool.failed" ||
      event.kind === "model.failed" ||
      event.kind === "session.failed"
  ).length;
  const artifact = events.some(
    (event) =>
      event.kind === "artifact.recorded" &&
      event.data.path === taskDefinition.file
  );
  const automaticApproval = events.some(
    (event) =>
      event.kind === "approval.decided" &&
      event.data.automatic === true &&
      event.data.policy === "workspace-auto" &&
      event.data.allowed === true
  );
  const success =
    run.exitCode === 0 &&
    session?.status === "completed" &&
    content === taskDefinition.token &&
    artifact &&
    events.filter((event) => event.kind === "artifact.recorded").length >= 2 &&
    automaticApproval;
  const usage = session?.usage ?? {};
  return {
    arm: armName,
    taskId: taskDefinition.id,
    seed,
    sessionId: session?.id ?? null,
    exitCode: run.exitCode,
    success,
    wallMs,
    usage,
    costUsd: estimateCost(usage),
    toolCalls,
    modelTurns,
    userInterventions,
    errors,
    artifact,
    automaticApproval,
    resultContent: content,
    stderr: redact(run.stderr).slice(0, 2_000)
  };
}

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) =>
      resolve({ exitCode: exitCode ?? 1, stdout, stderr })
    );
  });
}

function buildReport(pairedRuns) {
  const optimizedRuns = pairedRuns.map((pair) => pair.optimized);
  const baselineRuns = pairedRuns.map((pair) => pair.baseline);
  const optimizedSuccesses = optimizedRuns.filter((run) => run.success);
  const baselineSuccesses = baselineRuns.filter((run) => run.success);
  const optimizedSuccessRate = optimizedSuccesses.length / optimizedRuns.length;
  const baselineSuccessRate = baselineSuccesses.length / baselineRuns.length;
  const optimizedCost = costPerSuccess(optimizedRuns);
  const baselineCost = costPerSuccess(baselineRuns);
  const optimizedMedianMs = median(optimizedSuccesses.map((run) => run.wallMs));
  const baselineMedianMs = median(baselineSuccesses.map((run) => run.wallMs));
  const costReduction =
    baselineCost > 0 ? (baselineCost - optimizedCost) / baselineCost : 0;
  const timeReduction =
    baselineMedianMs > 0
      ? (baselineMedianMs - optimizedMedianMs) / baselineMedianMs
      : 0;
  const bootstrap = bootstrapIntervals(pairedRuns);
  const summary = {
    optimizedCostPerSuccessUsd: optimizedCost,
    baselineCostPerSuccessUsd: baselineCost,
    costReduction,
    costReductionCi95: bootstrap.costReductionCi95,
    optimizedMedianMs,
    baselineMedianMs,
    timeReduction,
    timeReductionCi95: bootstrap.timeReductionCi95,
    optimizedSuccessRate,
    baselineSuccessRate,
    successRegressionPoints: (baselineSuccessRate - optimizedSuccessRate) * 100
  };
  return {
    schema: "neonforge.ab-paired-report.v2",
    applicationVersion: "0.1.0",
    workspaceRevision: sourceRevision(),
    model: process.env.OPENAI_MODEL,
    protocol: "openai-chat",
    providerBaseUrl: process.env.OPENAI_BASE_URL,
    externalBaselineHash: readJson("benchmarks/external-baseline.json").integrityHash,
    fixtureHash: digest(
      readFileSync(join(process.cwd(), "tests", "fixtures", "e2e-workspace", "README.md"))
    ),
    personaFixtureHash: digest(
      readFileSync(join(process.cwd(), "tests", "personas", "personas.json"))
    ),
    generatedAt: new Date().toISOString(),
    seedBase,
    repetitions,
    pairedSamples: pairedRuns.length,
    tasks,
    armDefinition: arms,
    thresholds: threshold,
    pricingBasis: {
      currency: "USD",
      cacheHitPerMillion: 0.003,
      cacheMissPerMillion: 0.15,
      outputPerMillion: 0.6,
      source: "benchmarks/external-baseline.json"
    },
    pairs: pairedRuns,
    guardrails: {
      optimized: guardrail(optimizedRuns),
      baseline: guardrail(baselineRuns)
    },
    summary
  };
}

function guardrail(runs) {
  const successful = runs.filter((run) => run.success);
  return {
    medianWallMs: median(successful.map((run) => run.wallMs)),
    p95WallMs: percentile(successful.map((run) => run.wallMs), 95),
    medianInputTokens: median(successful.map((run) => run.usage.inputTokens ?? 0)),
    medianOutputTokens: median(successful.map((run) => run.usage.outputTokens ?? 0)),
    medianReasoningTokens: median(
      successful.map((run) => run.usage.reasoningTokens ?? 0)
    ),
    medianCacheHitTokens: median(
      successful.map((run) => run.usage.cacheHitTokens ?? 0)
    ),
    medianCacheMissTokens: median(
      successful.map((run) => run.usage.cacheMissTokens ?? 0)
    ),
    medianToolCalls: median(successful.map((run) => run.toolCalls)),
    medianModelTurns: median(successful.map((run) => run.modelTurns)),
    medianUserInterventions: median(
      successful.map((run) => run.userInterventions)
    ),
    errorRuns: runs.filter((run) => run.errors > 0).length
  };
}

function bootstrapIntervals(pairedRuns, iterations = 1_500) {
  const random = mulberry32(seedBase);
  const costReductions = [];
  const timeReductions = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = [];
    for (let index = 0; index < pairedRuns.length; index += 1) {
      sample.push(pairedRuns[Math.floor(random() * pairedRuns.length)]);
    }
    const optimized = sample.map((pair) => pair.optimized);
    const baseline = sample.map((pair) => pair.baseline);
    const optimizedCost = costPerSuccess(optimized);
    const baselineCost = costPerSuccess(baseline);
    if (baselineCost > 0 && Number.isFinite(optimizedCost)) {
      costReductions.push((baselineCost - optimizedCost) / baselineCost);
    }
    const optimizedTime = median(
      optimized.filter((run) => run.success).map((run) => run.wallMs)
    );
    const baselineTime = median(
      baseline.filter((run) => run.success).map((run) => run.wallMs)
    );
    if (baselineTime > 0) {
      timeReductions.push((baselineTime - optimizedTime) / baselineTime);
    }
  }
  return {
    costReductionCi95: confidenceInterval(costReductions),
    timeReductionCi95: confidenceInterval(timeReductions)
  };
}

function costPerSuccess(runs) {
  const successes = runs.filter((run) => run.success);
  if (!successes.length) return Number.POSITIVE_INFINITY;
  return (
    runs.reduce((sum, run) => sum + run.costUsd, 0) / successes.length
  );
}

function estimateCost(usage = {}) {
  const hit = usage.cacheHitTokens ?? 0;
  const miss =
    usage.cacheMissTokens ?? Math.max(0, (usage.inputTokens ?? 0) - hit);
  return (
    (hit * 0.003 + miss * 0.15 + (usage.outputTokens ?? 0) * 0.6) / 1_000_000
  );
}

function readEvents(home, sessionId) {
  if (!sessionId) return [];
  const path = join(home, "sessions", sessionId, "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseResult(stdout) {
  const lines = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    });
  return lines.filter(Boolean).at(-1);
}

function task(id, token) {
  const file = `draft-${id}.txt`;
  const draftToken = `${token}_DRAFT`;
  const finalToken = `${token}_FINAL`;
  return {
    id,
    file,
    token: finalToken,
    draftToken,
    prompt:
      `Work in the current workspace. First use read_file to read README.md and benchmark-context.txt. ` +
      `Then use write_file to create ${file} with exactly ${draftToken}. ` +
      `Then use apply_patch on ${file} to replace _DRAFT with _FINAL. ` +
      `Then use read_file to verify ${file}. Do not run shell commands. Do not ask questions. ` +
      `The final file must contain exactly ${finalToken}. Reply DONE after verification.`
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}


function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1
  );
  return sorted[index];
}

function confidenceInterval(values) {
  if (!values.length) return [0, 0];
  return [percentile(values, 2.5), percentile(values, 97.5)];
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function redact(value) {
  const secret = process.env.OPENAI_API_KEY;
  let redacted = String(value);
  if (secret) redacted = redacted.replaceAll(secret, "***");
  return redacted.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
}
