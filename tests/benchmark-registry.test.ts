import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  loadBaselineRegistry,
  verifyBaselineRegistry
} from "../packages/benchmarks/src/index.ts";

test("confirmed local baseline registry verifies offline", () => {
  const result = verifyBaselineRegistry(process.cwd());
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  const registry = loadBaselineRegistry(process.cwd());
  assert.ok(registry.entries.length >= 2);
  assert.ok(registry.candidates.length >= 3);
  const bugHunt = registry.entries.find(
    (entry) => entry.id === "bug-hunt-bench-2026-10-27"
  );
  assert.equal(bugHunt?.canonical, false);
  assert.equal(bugHunt?.status, "confirmed");
  assert.ok(bugHunt?.adapterPath);
  assert.ok(bugHunt?.localFiles.length);
});

test("registry verification detects source hash drift", () => {
  const root = mkdtempSync(join(tmpdir(), "neonforge-baseline-registry-"));
  mkdirSync(join(root, "benchmarks"), { recursive: true });
  const source = Buffer.from("confirmed source\n");
  const normalized = Buffer.from('{"value":1}\n');
  writeFileSync(join(root, "benchmarks", "source.txt"), source);
  writeFileSync(join(root, "benchmarks", "normalized.json"), normalized);
  writeFileSync(join(root, "benchmarks", "adapter.json"), "{}\n");
  const registry = {
    schema: "neonforge.baseline-registry.v1",
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: [
      {
        id: "fixture",
        kind: "model-quality",
        status: "confirmed",
        canonical: true,
        publisher: "Fixture",
        benchmarkVersion: "v1",
        canonicalModel: "deepseek-flash",
        modelVersion: "fixture",
        retrievalDate: new Date().toISOString(),
        methodology: "fixture",
        sources: [
          {
            url: "https://example.com/source",
            publisher: "Fixture",
            retrievedAt: new Date().toISOString(),
            title: "Fixture"
          }
        ],
        localFiles: [
          {
            path: "benchmarks/source.txt",
            sha256: digest(source),
            bytes: source.byteLength,
            mediaType: "text/plain",
            role: "official-source"
          }
        ],
        normalizedPath: "benchmarks/normalized.json",
        normalizedHash: digest(normalized),
        adapterPath: "benchmarks/adapter.json",
        integrityHash: digest(normalized)
      }
    ],
    candidates: []
  };
  writeFileSync(
    join(root, "benchmarks", "registry.json"),
    `${JSON.stringify(registry, null, 2)}\n`
  );
  assert.equal(verifyBaselineRegistry(root).ok, true);
  writeFileSync(join(root, "benchmarks", "source.txt"), "tampered\n");
  const result = verifyBaselineRegistry(root);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "file-hash"));
});

test("benchmark CLI verifies the registry and adapter contract", () => {
  const cli = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "apps/cli/src/main.ts", "benchmark", "verify", "--json"],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.equal(cli.status, 0, cli.stderr);
  const output = JSON.parse(cli.stdout.trim());
  assert.equal(output.ok, true);

  const adapter = spawnSync(
    process.execPath,
    ["scripts/benchmarks/bug-hunt-bench.mjs", "--validate"],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.equal(adapter.status, 0, adapter.stderr);
  assert.match(adapter.stdout, /PASS: bug-hunt-bench contract validated/);
});

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
