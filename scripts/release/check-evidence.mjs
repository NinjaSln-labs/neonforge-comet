import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { sourceRevision } from "../lib/source-revision.mjs";
import { inspectInstaller } from "./evidence-bundle.mjs";

const root = process.cwd();
const failures = [];
const currentRevision = sourceRevision();
const inputIndex = process.argv.indexOf("--input");
const inputPath =
  inputIndex >= 0 && process.argv[inputIndex + 1]
    ? process.argv[inputIndex + 1]
    : "dist";
const evidenceRoot = resolve(root, inputPath);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function readEvidenceJson(path) {
  return JSON.parse(await readFile(resolve(evidenceRoot, path), "utf8"));
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function recordedEvidencePath(path) {
  const normalized = path.replaceAll("\\", "/");
  return resolve(evidenceRoot, normalized.startsWith("dist/") ? normalized.slice(5) : normalized);
}

for (const platform of ["linux", "darwin", "windows"]) {
  const smoke = await readEvidenceJson(`smoke/${platform}-tui.json`);
  check(smoke.schema === "neonforge.tui-smoke.v2", `${platform} TUI smoke schema is stale`);
  check(smoke.workspaceRevision === currentRevision, `${platform} TUI smoke is not bound to the current revision`);
  check(smoke.passed === true, `${platform} TUI smoke did not pass every timeline check`);
  check(smoke.results?.length === 12, `${platform} TUI smoke does not cover 12 personas`);
  check(
    smoke.results?.every(
      (result) =>
        result.exitCode === 0 &&
        result.timeline &&
        result.usage &&
        result.diff &&
        result.approval &&
        result.completed
    ),
    `${platform} TUI smoke is missing a required timeline feature`
  );
  const reportBytes = readFileSync(recordedEvidencePath(smoke.personaReport));
  check(
    createHash("sha256").update(reportBytes).digest("hex") === smoke.personaReportHash,
    `${platform} TUI smoke report hash does not match its persona evidence`
  );
}

const protocols = {
  "openai-chat": "openai-chat-EVIDENCE",
  "openai-responses": "openai-responses-EVIDENCE",
  "anthropic-messages": "anthropic-messages-EVIDENCE",
};

for (const [protocol, token] of Object.entries(protocols)) {
  const evidence = await readEvidenceJson(`protocol-smoke/${protocol}.json`);
  const result = evidence.result;
  check(evidence.schema === "neonforge.protocol-smoke.v2", `${protocol} smoke schema is stale`);
  check(evidence.workspaceRevision === currentRevision, `${protocol} smoke is not bound to the current revision`);
  check(evidence.streaming === true, `${protocol} smoke did not exercise streaming`);
  check(evidence.passed === true, `${protocol} smoke did not pass`);
  check(result?.session?.status === "completed", `${protocol} session did not complete`);
  check(result?.session?.protocol === protocol, `${protocol} session reported the wrong protocol`);
  check(result?.content === token, `${protocol} smoke output is missing ${token}`);
}

for (const platform of ["linux-x64", "darwin-x64", "win32-x64"]) {
  const report = await readEvidenceJson(`e2e/personas-${platform}.json`);
  check(report.schema === "neonforge.persona-e2e.v2", `${platform} persona report schema is stale`);
  check(
    report.workspaceRevision === currentRevision,
    `${platform} persona report is not bound to the current workspace revision`,
  );
  check(report.results?.length === 12, `${platform} persona report does not contain 12 scenarios`);
  check(
    report.results?.every((result) => result.passed && result.p0.length === 0 && result.p1.length === 0),
    `${platform} persona report contains a failed or defect-bearing scenario`,
  );
  check(
    report.results?.every((result) => result.evaluator?.verdict === "pass"),
    `${platform} persona report lacks independent evaluator passes`,
  );
  check(report.tuiSmoke?.passed === true, `${platform} persona report lacks a passing TUI smoke`);
}

const ab = await readEvidenceJson("benchmarks/ab.json");
check(ab.schema === "neonforge.ab-paired-report.v2", "A/B report schema is stale");
check(ab.workspaceRevision === currentRevision, "A/B report is not bound to the current workspace revision");
check(ab.pairedSamples >= 6, "A/B report has fewer than six paired samples");
check(ab.summary?.costReduction >= 0.15, "A/B report misses the 15% cost threshold");
check(ab.summary?.timeReduction >= 0.1, "A/B report misses the 10% wall-time threshold");
check(ab.summary?.successRegressionPoints <= 2, "A/B report shows a success regression over 2 points");
check(ab.summary?.costReductionCi95?.length === 2, "A/B report lacks a cost confidence interval");
check(ab.summary?.timeReductionCi95?.length === 2, "A/B report lacks a time confidence interval");

const baseline = await readJson("benchmarks/external-baseline.json");
check(
  baseline.integrityHash === "975bd3fdcd9a65181d95d01d55d58d6cbb0c0c0cc20f5fe60ef5975effb884e8",
  "external baseline integrity hash changed",
);
check(baseline.sources?.length >= 3, "external baseline has fewer than three sources");
check(ab.externalBaselineHash === baseline.integrityHash, "A/B report does not bind to the external baseline");

const baselineVerify = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "apps/cli/src/main.ts", "benchmark", "verify", "--json"],
  { cwd: root, encoding: "utf8" }
);
check(
  baselineVerify.status === 0,
  `offline baseline registry verification failed: ${baselineVerify.stderr.trim()}`
);
if (baselineVerify.status === 0) {
  const result = JSON.parse(baselineVerify.stdout.trim());
  check(result.ok === true, "offline baseline registry reported issues");
  check(result.registry?.entries?.length >= 2, "baseline registry has fewer than two confirmed entries");
  check(result.registry?.candidates?.length >= 3, "baseline registry has fewer than three staged candidates");
  const bugHunt = result.registry?.entries?.find(
    (entry) => entry.id === "bug-hunt-bench-2026-10-27"
  );
  check(bugHunt?.canonical === false, "Bug Hunt Bench snapshot must not be canonical in V1");
  check(Boolean(bugHunt?.adapterPath), "Bug Hunt Bench adapter is missing");
}
const adapterVerify = spawnSync(
  process.execPath,
  ["scripts/benchmarks/bug-hunt-bench.mjs", "--validate"],
  { cwd: root, encoding: "utf8" }
);
check(
  adapterVerify.status === 0,
  `Bug Hunt Bench adapter validation failed: ${adapterVerify.stderr.trim()}`
);

for (const platform of ["linux", "darwin", "windows"]) {
  const artifact = resolve(evidenceRoot, `installers/neonforge-${platform}-x64.tgz`);
  const size = (await stat(artifact)).size;
  check(size < 50_000_000, `${platform} installer exceeds the 50 MB limit`);
  const release = await readEvidenceJson(`installers/release-${platform}-x64.json`);
  check(release.workspaceRevision === currentRevision, `${platform} installer evidence is stale`);
  check(release.license === "MIT", `${platform} installer does not declare MIT`);
  check(
    JSON.stringify(release.legalFiles) === JSON.stringify(["LICENSE", "THIRD_PARTY_NOTICES"]),
    `${platform} installer evidence does not list both legal files`
  );
  check(release.artifact === `dist/installers/neonforge-${platform}-x64.tgz`, `${platform} installer path is not portable`);
  check(release.bytes === size, `${platform} installer byte size is stale`);
  try {
    inspectInstaller(artifact);
  } catch (error) {
    check(false, `${platform} installer inspection failed: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `PASS: TUI, protocol, persona, benchmark, baseline, and installer evidence verified from ${relative(root, evidenceRoot) || "."}.`
  );
}

