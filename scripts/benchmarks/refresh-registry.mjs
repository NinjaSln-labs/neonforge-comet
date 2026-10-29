import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { extname, resolve } from "node:path";

const root = process.cwd();
const sourcePath = resolve(root, "benchmarks/registry.source.json");
const targetPath = resolve(root, "benchmarks/registry.json");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));

if (source.schema !== "neonforge.baseline-registry-source.v1") {
  throw new Error("Unexpected baseline registry source schema.");
}

const entries = source.entries.map((entry) => {
  const localFiles = entry.localFiles.map((path) => {
    const absolute = resolve(root, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(`Missing baseline source file: ${path}`);
    }
    const bytes = readFileSync(absolute);
    return {
      path,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      mediaType: mediaType(path),
      role: role(path)
    };
  });
  const normalizedAbsolute = entry.normalizedPath
    ? resolve(root, entry.normalizedPath)
    : undefined;
  const normalizedHash = normalizedAbsolute
    ? sha256(readFileSync(normalizedAbsolute))
    : undefined;
  if (entry.adapterPath && !existsSync(resolve(root, entry.adapterPath))) {
    throw new Error(`Missing adapter: ${entry.adapterPath}`);
  }
  return {
    ...entry,
    localFiles,
    ...(normalizedHash ? { normalizedHash } : {}),
    ...(entry.integrityHash ? {} : normalizedHash ? { integrityHash: normalizedHash } : {})
  };
});

const registry = {
  schema: "neonforge.baseline-registry.v1",
  version: source.version,
  updatedAt: new Date().toISOString(),
  entries,
  candidates: source.candidates
};
writeFileSync(targetPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(
  `Wrote ${targetPath}: ${entries.length} confirmed entries, ` +
    `${registry.candidates.length} staged candidates.`
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function mediaType(path) {
  const extension = extname(path).toLowerCase();
  return (
    {
      ".html": "text/html",
      ".md": "text/markdown",
      ".txt": "text/plain",
      ".json": "application/json",
      ".csv": "text/csv"
    }[extension] ?? "application/octet-stream"
  );
}

function role(path) {
  if (path.includes("/results/")) {
    if (path.endsWith("prompt.md")) return "prompt";
    if (path.endsWith(".csv")) return "raw-results";
    return "method-or-notes";
  }
  if (path.includes("2026-10-20")) return "published-secondary";
  if (path.endsWith(".json")) return "normalized";
  return "official-source";
}
