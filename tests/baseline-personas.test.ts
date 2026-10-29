import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("external baseline snapshot has a valid integrity hash and no local claims", () => {
  const baseline = JSON.parse(
    readFileSync(join(root, "benchmarks", "external-baseline.json"), "utf8")
  ) as {
    sources: unknown[];
    integrityHash: string;
    canonicalModel: string;
  };
  const hash = createHash("sha256")
    .update(JSON.stringify(baseline.sources))
    .digest("hex");
  assert.equal(baseline.canonicalModel, "deepseek-flash");
  assert.equal(baseline.integrityHash, hash);
});

test("persona matrix contains 12 unique personas", () => {
  const personas = JSON.parse(
    readFileSync(join(root, "tests", "personas", "personas.json"), "utf8")
  ) as Array<{ id: string }>;
  assert.equal(personas.length, 12);
  assert.equal(new Set(personas.map((persona) => persona.id)).size, 12);
});
