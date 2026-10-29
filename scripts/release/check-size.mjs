import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const limit = 50_000_000;
const dir = join(process.cwd(), "dist", "installers");
let installers = [];
try {
  installers = readdirSync(dir).filter((name) => name.endsWith(".tgz"));
} catch {
  console.error(`No installer directory at ${dir}. Run scripts/release/build.mjs first.`);
  process.exit(1);
}

if (installers.length === 0) {
  console.error("No installer artifacts found.");
  process.exit(1);
}

let failed = false;
for (const name of installers) {
  const path = join(dir, name);
  const bytes = statSync(path).size;
  console.log(`${name}\t${bytes} bytes`);
  if (bytes >= limit) {
    console.error(`FAIL: ${name} is not smaller than ${limit} bytes.`);
    failed = true;
  }
}

for (const name of readdirSync(dir).filter((item) => item.startsWith("release-") && item.endsWith(".json"))) {
  const evidence = JSON.parse(readFileSync(join(dir, name), "utf8"));
  if (evidence.containsModelWeights || evidence.containsBrowserEngine) {
    console.error(`FAIL: ${name} declares forbidden bundled runtime content.`);
    failed = true;
  }
  if (typeof evidence.workspaceRevision !== "string" || !/^[a-f0-9]{64}$/.test(evidence.workspaceRevision)) {
    console.error(`FAIL: ${name} is not bound to a workspace revision.`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`PASS: ${installers.length} installer(s) are below ${limit} bytes.`);
