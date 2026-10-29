import {
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const files = ["LICENSE", "THIRD_PARTY_NOTICES", "package.json"];
for (const path of [".github", "apps", "docs/release", "packages", "scripts", "tests"]) {
  walk(path, files);
}
files.sort();
writeFileSync(
  join(root, "source-manifest.json"),
  `${JSON.stringify(
    {
      schema: "neonforge.source-manifest.v1",
      files
    },
    null,
    2
  )}\n`
);
console.log(`Wrote source-manifest.json with ${files.length} files.`);

function walk(path, output) {
  const absolute = join(root, path);
  const entryStat = statSync(absolute);
  if (entryStat.isFile()) {
    output.push(relative(root, absolute).replaceAll("\\", "/"));
    return;
  }
  for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) walk(child, output);
    else if (entry.isFile()) {
      output.push(relative(root, join(root, child)).replaceAll("\\", "/"));
    }
  }
}
