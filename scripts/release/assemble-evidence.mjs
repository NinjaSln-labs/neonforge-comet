import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { assembleEvidenceBundle } from "./evidence-bundle.mjs";

const workspaceRoot = resolve(argument("--workspace") ?? process.cwd());
const inputRoot = resolve(workspaceRoot, argument("--input") ?? "dist");
const outputRoot = resolve(
  workspaceRoot,
  argument("--output") ?? "dist/release-evidence"
);
const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
let generatedAt;
if (sourceDateEpoch) {
  const seconds = Number(sourceDateEpoch);
  if (!Number.isFinite(seconds)) {
    console.error("SOURCE_DATE_EPOCH must be a numeric Unix timestamp.");
    process.exit(2);
  }
  generatedAt = new Date(seconds * 1000).toISOString();
} else {
  generatedAt = new Date().toISOString();
}

const validation = spawnSync(
  process.execPath,
  [join(workspaceRoot, "scripts/release/check-evidence.mjs"), "--input", inputRoot],
  {
    cwd: workspaceRoot,
    encoding: "utf8"
  }
);
process.stdout.write(validation.stdout);
process.stderr.write(validation.stderr);
if (validation.status !== 0) {
  console.error("Evidence assembly stopped because input validation failed.");
  process.exit(validation.status ?? 1);
}

const result = assembleEvidenceBundle({
  workspaceRoot,
  inputRoot,
  outputRoot,
  generatedAt,
  checks: [
    {
      id: "verify-evidence-inputs",
      name: "Existing release evidence validation",
      result: "passed",
      note: "scripts/release/check-evidence.mjs validated every platform and protocol input."
    }
  ]
});
console.log(
  JSON.stringify(
    {
      schema: result.manifest.schema,
      sourceRevision: result.manifest.sourceRevision,
      gitCommit: result.manifest.gitCommit,
      files: result.manifest.files.length,
      bundleRoot: result.bundleRoot,
      archivePath: result.archivePath
    },
    null,
    2
  )
);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
