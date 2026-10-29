import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { join, relative } from "node:path";
import { sourceRevision } from "../lib/source-revision.mjs";

const platform = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch === "x64" ? "x64" : process.arch;
const root = process.cwd();
const dist = join(root, "dist");
const installers = join(dist, "installers");
const stage = join(dist, `stage-${platform}-${arch}`);
const bundle = join(dist, "neonforge.mjs");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (process.platform === "win32") {
  execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm build"], {
    cwd: root,
    stdio: "inherit"
  });
} else {
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
}
mkdirSync(stage, { recursive: true });
mkdirSync(installers, { recursive: true });
cpSync(bundle, join(stage, "neonforge.mjs"));
const legalFiles = ["LICENSE", "THIRD_PARTY_NOTICES"];
for (const file of legalFiles) {
  const source = join(root, file);
  if (!existsSync(source)) {
    throw new Error(`Missing required release file: ${file}`);
  }
  cpSync(source, join(stage, file));
}
writeFileSync(
  join(stage, "package.json"),
  `${JSON.stringify(
    {
      name: "neonforge",
      version: packageJson.version,
      license: packageJson.license,
      type: "module",
      bin: { neonforge: "./neonforge.mjs" },
      engines: { node: ">=22" }
    },
    null,
    2
  )}\n`
);

const artifact = join(installers, `neonforge-${platform}-${arch}.tgz`);
execFileSync("tar", ["-czf", artifact, "-C", stage, "."], {
  cwd: root,
  stdio: "inherit"
});
const archiveEntries = execFileSync("tar", ["-tzf", artifact], {
  cwd: root,
  encoding: "utf8"
})
  .split(/\r?\n/)
  .map((entry) => entry.replace(/^\.\//, ""))
  .filter(Boolean);
for (const file of legalFiles) {
  if (!archiveEntries.includes(file)) {
    throw new Error(`Installer is missing required release file: ${file}`);
  }
}

const evidence = {
  schema: "neonforge.release-evidence.v1",
  version: packageJson.version,
  license: packageJson.license,
  platform,
  arch,
  artifact: relative(root, artifact).replaceAll("\\", "/"),
  bytes: readFileSync(artifact).byteLength,
  legalFiles,
  runtime: "node>=22",
  containsModelWeights: false,
  containsBrowserEngine: false,
  workspaceRevision: sourceRevision(),
  builtAt: new Date().toISOString()
};
writeFileSync(
  join(installers, `release-${platform}-${arch}.json`),
  `${JSON.stringify(evidence, null, 2)}\n`
);
console.log(JSON.stringify(evidence));

