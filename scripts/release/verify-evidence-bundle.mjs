import { resolve } from "node:path";
import { verifyEvidenceBundle } from "./evidence-bundle.mjs";

const options = parseArguments(process.argv.slice(2));
if (!options.bundle) {
  console.error(
    "Usage: pnpm evidence:verify <bundle-directory-or-tgz> [--workspace <path>]"
  );
  process.exit(2);
}
const bundlePath = resolve(options.bundle);
const workspaceRoot = resolve(options.workspace ?? process.cwd());
const result = verifyEvidenceBundle({ bundlePath, workspaceRoot });
console.log(
  JSON.stringify(
    {
      schema: "neonforge.release-evidence-verification.v1",
      result: "passed",
      bundlePath,
      sourceRevision: result.sourceRevision,
      gitCommit: result.gitCommit,
      files: result.files,
      platforms: result.platforms,
      protocols: result.protocols
    },
    null,
    2
  )
);

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--bundle" || value === "--workspace") {
      parsed[value.slice(2)] = args[index + 1];
      index += 1;
    } else if (!value.startsWith("--")) {
      parsed.bundle ??= value;
    }
  }
  return parsed;
}
