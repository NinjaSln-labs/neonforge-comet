import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = process.argv.slice(2);
const files = [];
for (const root of roots.length ? roots : ["tests"]) {
  walk(root);
}

if (!files.length) {
  console.error("No test files found.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", "--experimental-strip-types", ...files],
  { stdio: "inherit" }
);
process.exit(result.status ?? 1);

function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(full);
  }
}
