import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sourceRevision } from "/workspace/neonforge-comet/scripts/lib/source-revision.mjs";

const root = "/workspace/neonforge-comet";
const expectedRevision =
  "fae019514a3fbb9cf3918ca9357249a1b51c7395d7ff11d0a60f7dda2fc2b3b2";
const read = (path) => readFileSync(join(root, path));
const json = (path) => JSON.parse(read(path).toString("utf8"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const result = {};

const revision = sourceRevision(root);
assert.equal(revision, expectedRevision);
const manifest = json("source-manifest.json");
assert.equal(manifest.schema, "neonforge.source-manifest.v1");
assert.equal(manifest.files.length, 49);
assert.equal(manifest.files.includes("docs/product/known-issues.md"), false);
result.revision = { actual: revision, manifestFileCount: manifest.files.length };

const e2e = {};
const allPersonaResults = [];
const expectedPersonas = json("tests/personas/personas.json").map(
  (persona) => persona.id
);
const fixtureHash = digest(read("tests/fixtures/e2e-workspace/README.md"));
const personaFixtureHash = digest(read("tests/personas/personas.json"));
for (const [platform, arch] of [
  ["linux", "x64"],
  ["darwin", "x64"],
  ["win32", "x64"]
]) {
  const path = `dist/e2e/personas-${platform}-${arch}.json`;
  const report = json(path);
  assert.equal(report.schema, "neonforge.persona-e2e.v2");
  assert.equal(report.workspaceRevision, expectedRevision);
  assert.equal(report.fixtureHash, fixtureHash);
  assert.equal(report.platform, platform);
  assert.equal(report.arch, arch);
  assert.equal(report.results.length, 12);
  assert.deepEqual(
    report.results.map((entry) => entry.persona).sort(),
    [...expectedPersonas].sort()
  );
  assert.equal(report.tuiSmoke.passed, true);
  for (const entry of report.results) {
    assert.equal(entry.passed, true);
    assert.deepEqual(entry.p0, []);
    assert.deepEqual(entry.p1, []);
    assert.equal(entry.evaluator.verdict, "pass");
    assert.notEqual(entry.evaluator.requestId, entry.simulator.requestId);
    assert.ok(
      Object.values(entry.target.deterministic).every((value) => value === true)
    );
    allPersonaResults.push(entry);
  }
  e2e[platform] = {
    count: report.results.length,
    evaluatorPasses: report.results.filter(
      (entry) => entry.evaluator.verdict === "pass"
    ).length,
    p0: report.results.reduce((sum, entry) => sum + entry.p0.length, 0),
    p1: report.results.reduce((sum, entry) => sum + entry.p1.length, 0)
  };
}
assert.equal(allPersonaResults.length, 36);
result.personas = e2e;
result.personaTotal = allPersonaResults.length;

const smoke = {};
for (const platform of ["linux", "darwin", "windows"]) {
  const path = `dist/smoke/${platform}-tui.json`;
  const report = json(path);
  assert.equal(report.schema, "neonforge.tui-smoke.v2");
  assert.equal(report.workspaceRevision, expectedRevision);
  assert.equal(report.passed, true);
  assert.equal(report.results.length, 12);
  assert.ok(
    report.results.every(
      (entry) =>
        entry.exitCode === 0 &&
        entry.timeline === true &&
        entry.usage === true &&
        entry.diff === true &&
        entry.approval === true &&
        entry.completed === true
    )
  );
  const personaBytes = read(report.personaReport);
  assert.equal(digest(personaBytes), report.personaReportHash);
  const personaReport = JSON.parse(personaBytes.toString("utf8"));
  const byPersona = new Map(
    personaReport.results.map((entry) => [entry.persona, entry])
  );
  for (const entry of report.results) {
    const source = byPersona.get(entry.persona);
    assert.ok(source);
    assert.equal(entry.sessionId, source.target.sessionId);
    assert.equal(entry.outputHash, digest(source.target.stdout));
  }
  smoke[platform] = {
    count: report.results.length,
    exitZero: report.results.filter((entry) => entry.exitCode === 0).length,
    reportHash: report.personaReportHash,
    linkedOutputs: report.results.length
  };
}
result.tuiSmoke = smoke;

const protocols = {};
for (const protocol of [
  "openai-chat",
  "openai-responses",
  "anthropic-messages"
]) {
  const report = json(`dist/protocol-smoke/${protocol}.json`);
  assert.equal(report.schema, "neonforge.protocol-smoke.v2");
  assert.equal(report.workspaceRevision, expectedRevision);
  assert.equal(report.protocol, protocol);
  assert.equal(report.streaming, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.passed, true);
  assert.equal(report.result.session.status, "completed");
  assert.equal(report.result.session.protocol, protocol);
  assert.equal(report.result.session.canonicalModel, "deepseek-flash");
  assert.match(report.result.session.modelSelectionReason, /DeepSeek family/);
  assert.equal(
    report.result.session.providerModel,
    "commandcode-plan/deepseek/deepseek-v4.1-flash"
  );
  protocols[protocol] = {
    exitCode: report.exitCode,
    streaming: report.streaming,
    providerModel: report.result.session.providerModel,
    canonicalModel: report.result.session.canonicalModel
  };
}
result.protocolSmoke = protocols;

const release = {};
const platformNames = [
  ["linux", "linux"],
  ["darwin", "darwin"],
  ["windows", "windows"]
];
for (const [recordPlatform, filePlatform] of platformNames) {
  const record = json(`dist/installers/release-${recordPlatform}-x64.json`);
  const artifact = `dist/installers/neonforge-${filePlatform}-x64.tgz`;
  const bytes = statSync(join(root, artifact)).size;
  assert.equal(record.platform, recordPlatform);
  assert.equal(record.arch, "x64");
  assert.equal(record.bytes, bytes);
  assert.equal(record.workspaceRevision, expectedRevision);
  assert.equal(record.runtime, "node>=22");
  assert.equal(record.containsModelWeights, false);
  assert.equal(record.containsBrowserEngine, false);
  assert.ok(bytes < 50_000_000);
  const listing = execFileSync("tar", ["-tzf", artifact], {
    cwd: root,
    encoding: "utf8"
  })
    .trim()
    .split("\n")
    .filter((entry) => entry !== "./");
  assert.deepEqual(listing.sort(), ["./neonforge.mjs", "./package.json"].sort());
  const packageJson = JSON.parse(
    execFileSync("tar", ["-xOf", artifact, "./package.json"], {
      cwd: root,
      encoding: "utf8"
    })
  );
  assert.equal(packageJson.engines.node, ">=22");
  const launch = spawnSync(
    process.execPath,
    ["-", "version"],
    {
      cwd: root,
      input: execFileSync("tar", ["-xOf", artifact, "./neonforge.mjs"], {
        cwd: root
      }),
      encoding: "utf8"
    }
  );
  assert.equal(launch.status, 0);
  assert.match(launch.stdout, /^neonforge 0\.1\.0/m);
  const bundle = execFileSync("tar", ["-xOf", artifact, "./neonforge.mjs"], {
    cwd: root
  }).toString("utf8");
  assert.doesNotMatch(
    bundle,
    /\.(?:gguf|safetensors|onnx|pt|pth)\b|playwright|puppeteer|chromium/i
  );
  release[recordPlatform] = {
    bytes,
    entries: listing,
    launch: launch.stdout.trim(),
    modelWeights: false,
    browserEngine: false
  };
}
result.installers = release;

const ab = json("dist/benchmarks/ab.json");
assert.equal(ab.schema, "neonforge.ab-paired-report.v2");
assert.equal(ab.workspaceRevision, expectedRevision);
assert.equal(ab.externalBaselineHash, json("benchmarks/external-baseline.json").integrityHash);
assert.equal(ab.fixtureHash, fixtureHash);
assert.equal(ab.personaFixtureHash, personaFixtureHash);
assert.equal(ab.pairs.length, 12);
assert.equal(ab.pairedSamples, 12);
assert.equal(ab.tasks.length, 6);
assert.equal(new Set(ab.tasks.map((task) => task.id)).size, 6);
assert.deepEqual(
  Object.fromEntries(
    [...new Set(ab.pairs.map((pair) => pair.taskId))]
      .sort()
      .map((id) => [id, ab.pairs.filter((pair) => pair.taskId === id).length])
  ),
  Object.fromEntries(ab.tasks.map((task) => [task.id, 2]))
);
for (const pair of ab.pairs) {
  assert.equal(pair.optimized.seed, pair.seed);
  assert.equal(pair.baseline.seed, pair.seed);
  assert.equal(pair.optimized.arm, "optimized");
  assert.equal(pair.baseline.arm, "baseline");
}
const optimized = ab.pairs.map((pair) => pair.optimized);
const baseline = ab.pairs.map((pair) => pair.baseline);
const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values, p) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
};
const costPerSuccess = (runs) =>
  runs.reduce((sum, run) => sum + run.costUsd, 0) /
  runs.filter((run) => run.success).length;
const optCost = costPerSuccess(optimized);
const baseCost = costPerSuccess(baseline);
const optTime = median(
  optimized.filter((run) => run.success).map((run) => run.wallMs)
);
const baseTime = median(
  baseline.filter((run) => run.success).map((run) => run.wallMs)
);
const costReduction = (baseCost - optCost) / baseCost;
const timeReduction = (baseTime - optTime) / baseTime;
const successRegressionPoints =
  (baseline.filter((run) => run.success).length / baseline.length -
    optimized.filter((run) => run.success).length / optimized.length) *
  100;
assert.equal(optimized.filter((run) => run.success).length, 12);
assert.equal(baseline.filter((run) => run.success).length, 11);
assert.ok(Math.abs(costReduction - ab.summary.costReduction) < 1e-12);
assert.ok(Math.abs(timeReduction - ab.summary.timeReduction) < 1e-12);
assert.ok(
  Math.abs(successRegressionPoints - ab.summary.successRegressionPoints) < 1e-12
);
assert.ok(costReduction >= ab.thresholds.costReduction);
assert.ok(timeReduction >= ab.thresholds.timeReduction);
assert.ok(successRegressionPoints <= ab.thresholds.successRegressionPoints);

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
const random = mulberry32(ab.seedBase);
const costBoot = [];
const timeBoot = [];
for (let iteration = 0; iteration < 1500; iteration += 1) {
  const sample = [];
  for (let index = 0; index < ab.pairs.length; index += 1) {
    sample.push(ab.pairs[Math.floor(random() * ab.pairs.length)]);
  }
  const sampleOpt = sample.map((pair) => pair.optimized);
  const sampleBase = sample.map((pair) => pair.baseline);
  const sampleOptCost = costPerSuccess(sampleOpt);
  const sampleBaseCost = costPerSuccess(sampleBase);
  if (Number.isFinite(sampleOptCost) && sampleBaseCost > 0) {
    costBoot.push((sampleBaseCost - sampleOptCost) / sampleBaseCost);
  }
  const sampleOptTime = median(
    sampleOpt.filter((run) => run.success).map((run) => run.wallMs)
  );
  const sampleBaseTime = median(
    sampleBase.filter((run) => run.success).map((run) => run.wallMs)
  );
  if (sampleBaseTime > 0) {
    timeBoot.push((sampleBaseTime - sampleOptTime) / sampleBaseTime);
  }
}
const costCi = [percentile(costBoot, 2.5), percentile(costBoot, 97.5)];
const timeCi = [percentile(timeBoot, 2.5), percentile(timeBoot, 97.5)];
assert.deepEqual(costCi, ab.summary.costReductionCi95);
assert.deepEqual(timeCi, ab.summary.timeReductionCi95);
result.ab = {
  pairs: ab.pairs.length,
  tasks: ab.tasks.length,
  optimizedSuccesses: 12,
  baselineSuccesses: 11,
  optimizedCostPerSuccessUsd: optCost,
  baselineCostPerSuccessUsd: baseCost,
  costReduction,
  costReductionCi95: costCi,
  optimizedMedianMs: optTime,
  baselineMedianMs: baseTime,
  timeReduction,
  timeReductionCi95: timeCi,
  successRegressionPoints
};

const registry = json("benchmarks/registry.json");
const externalBaseline = json("benchmarks/external-baseline.json");
assert.equal(registry.schema, "neonforge.baseline-registry.v1");
assert.equal(registry.entries.length, 2);
assert.equal(registry.candidates.length, 3);
assert.ok(registry.candidates.every((candidate) => candidate.status === "staged"));
assert.equal(
  digest(JSON.stringify(externalBaseline.sources)),
  externalBaseline.integrityHash
);
let fileHashCount = 0;
for (const entry of registry.entries) {
  assert.equal(entry.status, "confirmed");
  assert.equal(entry.sources.length > 0, true);
  assert.ok(entry.integrityHash);
  assert.ok(entry.methodology);
  for (const source of entry.sources) {
    assert.equal(new URL(source.url).protocol, "https:");
    assert.ok(source.retrievedAt);
  }
  for (const file of entry.localFiles) {
    const bytes = read(file.path);
    assert.equal(bytes.byteLength, file.bytes);
    assert.equal(digest(bytes), file.sha256);
    fileHashCount += 1;
  }
  if (entry.normalizedPath) {
    assert.equal(digest(read(entry.normalizedPath)), entry.normalizedHash);
    fileHashCount += 1;
  }
}
const official = registry.entries.find(
  (entry) => entry.id === "deepseek-official-2026-10-28"
);
const bugHunt = registry.entries.find(
  (entry) => entry.id === "bug-hunt-bench-2026-10-27"
);
assert.equal(official.canonical, true);
assert.equal(bugHunt.canonical, false);
assert.equal(bugHunt.adapterPath, "benchmarks/adapters/bug-hunt-bench/adapter.json");
assert.equal(json("benchmarks/bug-hunt-bench.json").v1Boundary.scoreClaim, null);
const adapter = json("benchmarks/adapters/bug-hunt-bench/adapter.json");
assert.equal(adapter.taskCount, 105);
assert.equal(adapter.repositories.length, 2);
assert.equal(adapter.runPolicy.attemptsPerTask, 5);
assert.equal(adapter.runPolicy.timeLimitSecondsPerRepository, 10800);
assert.equal(adapter.scoringContract.neonForgeMayNotSelfScore, true);
assert.equal(adapter.v1Boundary.scoreClaim, null);
assert.match(read("benchmarks/sources/README.md").toString("utf8"), /redistribut/i);
result.registry = {
  confirmedEntries: registry.entries.length,
  stagedCandidates: registry.candidates.length,
  verifiedHashes: fileHashCount,
  officialCanonical: official.canonical,
  bugHuntCanonical: bugHunt.canonical,
  bugHuntScoreClaim: adapter.v1Boundary.scoreClaim,
  externalBaselineHash: externalBaseline.integrityHash
};

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "buffer"
})
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const pathMatches = [];
const credentialMatches = [];
const pathPattern = /(?:^|["'\s])(?:\/(?:home|Users)\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[^\\\s"']+\\)/g;
const credentialPatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,})\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}\b/gi
];
for (const path of tracked) {
  const bytes = read(path);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const match of text.matchAll(pathPattern)) {
    pathMatches.push({ path, match: match[0].trim() });
  }
  for (const pattern of credentialPatterns) {
    for (const match of text.matchAll(pattern)) {
      credentialMatches.push({ path, match: match[0] });
    }
  }
}
result.trackedTreeScan = {
  trackedFiles: tracked.length,
  localHomePathMatches: pathMatches,
  credentialMatches
};

console.log(JSON.stringify(result, null, 2));
