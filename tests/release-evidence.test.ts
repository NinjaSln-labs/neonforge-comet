import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceRevision } from "../scripts/lib/source-revision.mjs";
import {
  REQUIRED_FILES,
  assembleEvidenceBundle,
  verifyEvidenceBundle
} from "../scripts/release/evidence-bundle.mjs";

const fixedCommit = "a".repeat(40);
const fixedTime = "2026-10-29T00:00:00.000Z";
const platforms = [
  { platform: "linux", persona: "linux" },
  { platform: "darwin", persona: "darwin" },
  { platform: "windows", persona: "win32" }
] as const;

test("assembles and verifies a complete evidence bundle", (t) => {
  const fixture = createFixture(t);
  const assembled = assembleEvidenceBundle({
    workspaceRoot: fixture.workspace,
    inputRoot: fixture.input,
    outputRoot: fixture.output,
    gitCommit: fixedCommit,
    generatedAt: fixedTime,
    checks: [
      {
        id: "fixture-check",
        name: "fixture check",
        result: "passed",
        note: "fixture"
      }
    ]
  });

  assert.equal(assembled.manifest.files.length, REQUIRED_FILES.length);
  assert.deepEqual(
    assembled.manifest.files.map((file) => file.path),
    [...assembled.manifest.files.map((file) => file.path)].sort()
  );
  const verified = verifyEvidenceBundle({
    bundlePath: assembled.bundleRoot,
    workspaceRoot: fixture.workspace,
    gitCommit: fixedCommit
  });
  assert.deepEqual(verified.platforms.sort(), ["darwin", "linux", "windows"]);
  assert.equal(verified.files, REQUIRED_FILES.length);
  assert.equal(
    verifyEvidenceBundle({
      bundlePath: assembled.archivePath,
      workspaceRoot: fixture.workspace,
      gitCommit: fixedCommit
    }).gitCommit,
    fixedCommit
  );
});

test("rejects stale evidence during assembly", (t) => {
  const fixture = createFixture(t);
  const smokePath = join(fixture.input, "smoke", "linux-tui.json");
  const smoke = JSON.parse(readFileSync(smokePath, "utf8"));
  smoke.workspaceRevision = "b".repeat(64);
  writeJson(smokePath, smoke);

  assert.throws(
    () =>
      assembleEvidenceBundle({
        workspaceRoot: fixture.workspace,
        inputRoot: fixture.input,
        outputRoot: fixture.output,
        gitCommit: fixedCommit,
        generatedAt: fixedTime
      }),
    /stale/
  );
});

test("rejects a wrong-platform evidence record", (t) => {
  const fixture = createFixture(t);
  const personaPath = join(
    fixture.input,
    "e2e",
    "personas-darwin-x64.json"
  );
  const report = JSON.parse(readFileSync(personaPath, "utf8"));
  report.platform = "linux";
  writeJson(personaPath, report);

  assert.throws(
    () =>
      assembleEvidenceBundle({
        workspaceRoot: fixture.workspace,
        inputRoot: fixture.input,
        outputRoot: fixture.output,
        gitCommit: fixedCommit,
        generatedAt: fixedTime
      }),
    /does not come from darwin-x64/
  );
});

test("rejects duplicate or unexpected evidence files", (t) => {
  const fixture = createFixture(t);
  copyFileSync(
    join(fixture.input, "protocol-smoke", "openai-chat.json"),
    join(fixture.input, "protocol-smoke", "openai-chat-copy.json")
  );

  assert.throws(
    () =>
      assembleEvidenceBundle({
        workspaceRoot: fixture.workspace,
        inputRoot: fixture.input,
        outputRoot: fixture.output,
        gitCommit: fixedCommit,
        generatedAt: fixedTime
      }),
    /Unexpected evidence file: protocol-smoke\/openai-chat-copy\.json/
  );
});

test("rejects missing required evidence", (t) => {
  const fixture = createFixture(t);
  rmSync(join(fixture.input, "protocol-smoke", "anthropic-messages.json"));
  assert.throws(
    () =>
      assembleEvidenceBundle({
        workspaceRoot: fixture.workspace,
        inputRoot: fixture.input,
        outputRoot: fixture.output,
        gitCommit: fixedCommit,
        generatedAt: fixedTime
      }),
    /Missing required evidence file/
  );
});

test("rejects an installer without both legal files", (t) => {
  const fixture = createFixture(t);
  const stage = join(fixture.root, "bad-installer");
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "LICENSE"), "MIT License\n");
  writeJson(join(stage, "package.json"), {
    name: "neonforge",
    version: "0.1.0",
    license: "MIT"
  });
  writeFileSync(join(stage, "neonforge.mjs"), "console.log('ok');\n");
  execFileSync("tar", [
    "-czf",
    join(fixture.input, "installers", "neonforge-linux-x64.tgz"),
    "-C",
    stage,
    "."
  ]);

  assert.throws(
    () =>
      assembleEvidenceBundle({
        workspaceRoot: fixture.workspace,
        inputRoot: fixture.input,
        outputRoot: fixture.output,
        gitCommit: fixedCommit,
        generatedAt: fixedTime
      }),
    /missing THIRD_PARTY_NOTICES/
  );
});

test("offline verification rejects tampering and credential leakage", (t) => {
  const fixture = createFixture(t);
  const assembled = assembleEvidenceBundle({
    workspaceRoot: fixture.workspace,
    inputRoot: fixture.input,
    outputRoot: fixture.output,
    gitCommit: fixedCommit,
    generatedAt: fixedTime
  });
  appendFileSync(join(assembled.bundleRoot, "files", "LICENSE"), "\ntampered\n");
  assert.throws(
    () =>
      verifyEvidenceBundle({
        bundlePath: assembled.bundleRoot,
        workspaceRoot: fixture.workspace,
        gitCommit: fixedCommit
      }),
    /hash or size mismatch/
  );

  const second = createFixture(t);
  const smokePath = join(second.input, "protocol-smoke", "openai-chat.json");
  const evidence = JSON.parse(readFileSync(smokePath, "utf8"));
  evidence.result[["api", "key"].join("_")] = "test-value";
  writeJson(smokePath, evidence);
  assert.throws(
    () =>
      assembleEvidenceBundle({
        workspaceRoot: second.workspace,
        inputRoot: second.input,
        outputRoot: second.output,
        gitCommit: fixedCommit,
        generatedAt: fixedTime
      }),
    /non-redacted api_key field/
  );
});

test("identical inputs produce a canonical manifest", (t) => {
  const fixture = createFixture(t);
  const first = assembleEvidenceBundle({
    workspaceRoot: fixture.workspace,
    inputRoot: fixture.input,
    outputRoot: fixture.output,
    gitCommit: fixedCommit,
    generatedAt: fixedTime
  });
  const firstManifest = readFileSync(
    join(first.bundleRoot, "bundle.json"),
    "utf8"
  );
  const second = assembleEvidenceBundle({
    workspaceRoot: fixture.workspace,
    inputRoot: fixture.input,
    outputRoot: fixture.output,
    gitCommit: fixedCommit,
    generatedAt: fixedTime
  });
  assert.equal(
    readFileSync(join(second.bundleRoot, "bundle.json"), "utf8"),
    firstManifest
  );
});

function createFixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "neonforge-evidence-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const input = join(root, "dist");
  const output = join(root, "bundle");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(input, "smoke"), { recursive: true });
  mkdirSync(join(input, "e2e"), { recursive: true });
  mkdirSync(join(input, "protocol-smoke"), { recursive: true });
  mkdirSync(join(input, "benchmarks"), { recursive: true });
  mkdirSync(join(input, "installers"), { recursive: true });

  writeFileSync(join(workspace, "LICENSE"), "MIT License\n");
  writeFileSync(join(workspace, "THIRD_PARTY_NOTICES"), "Third-party notices\n");
  writeJson(join(workspace, "package.json"), {
    name: "neonforge",
    version: "0.1.0",
    license: "MIT"
  });
  writeJson(join(workspace, "source-manifest.json"), {
    schema: "neonforge.source-manifest.v1",
    files: ["LICENSE", "THIRD_PARTY_NOTICES", "package.json"]
  });
  const revision = sourceRevision(workspace);
  const results = Array.from({ length: 12 }, (_, index) => ({
    persona: `persona-${index}`,
    passed: true,
    p0: [],
    p1: [],
    evaluator: { verdict: "pass" }
  }));

  for (const { platform, persona } of platforms) {
    writeJson(join(input, "smoke", `${platform}-tui.json`), {
      schema: "neonforge.tui-smoke.v2",
      workspaceRevision: revision,
      platform,
      arch: "x64",
      passed: true,
      personaReport: `dist/e2e/personas-${persona}-x64.json`,
      results
    });
    writeJson(join(input, "e2e", `personas-${persona}-x64.json`), {
      schema: "neonforge.persona-e2e.v2",
      workspaceRevision: revision,
      platform: persona,
      arch: "x64",
      tuiSmoke: { passed: true },
      results
    });
    const stage = join(root, `stage-${platform}`);
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "LICENSE"), "MIT License\n");
    writeFileSync(join(stage, "THIRD_PARTY_NOTICES"), "Third-party notices\n");
    writeJson(join(stage, "package.json"), {
      name: "neonforge",
      version: "0.1.0",
      license: "MIT"
    });
    writeFileSync(join(stage, "neonforge.mjs"), "console.log('ok');\n");
    const installer = join(
      input,
      "installers",
      `neonforge-${platform}-x64.tgz`
    );
    execFileSync("tar", ["-czf", installer, "-C", stage, "."]);
    writeJson(
      join(input, "installers", `release-${platform}-x64.json`),
      {
        schema: "neonforge.release-evidence.v1",
        version: "0.1.0",
        license: "MIT",
        platform,
        arch: "x64",
        artifact: `dist/installers/neonforge-${platform}-x64.tgz`,
        bytes: readFileSync(installer).byteLength,
        legalFiles: ["LICENSE", "THIRD_PARTY_NOTICES"],
        workspaceRevision: revision
      }
    );
  }

  for (const protocol of [
    "openai-chat",
    "openai-responses",
    "anthropic-messages"
  ]) {
    writeJson(join(input, "protocol-smoke", `${protocol}.json`), {
      schema: "neonforge.protocol-smoke.v2",
      workspaceRevision: revision,
      protocol,
      streaming: true,
      passed: true,
      result: { session: { status: "completed" } }
    });
  }
  writeJson(join(input, "benchmarks", "ab.json"), {
    schema: "neonforge.ab-paired-report.v2",
    workspaceRevision: revision,
    pairedSamples: 12,
    summary: {
      costReduction: 0.8,
      timeReduction: 0.2,
      successRegressionPoints: 0
    }
  });

  return { root, workspace, input, output, revision };
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
