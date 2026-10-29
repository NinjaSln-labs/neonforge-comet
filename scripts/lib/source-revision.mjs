import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function sourceRevision(root = process.cwd()) {
  const manifestPath = resolve(root, "source-manifest.json");
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schema !== "neonforge.source-manifest.v1") {
    throw new Error("source-manifest.json schema is invalid");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("source-manifest.json must list at least one file");
  }
  if (new Set(manifest.files).size !== manifest.files.length) {
    throw new Error("source-manifest.json contains duplicate files");
  }
  const hash = createHash("sha256");
  hash.update(manifestBytes);
  hash.update("\0");
  for (const path of [...manifest.files].sort()) {
    if (isAbsolute(path)) {
      throw new Error(`source manifest path must be relative: ${path}`);
    }
    const full = resolve(root, path);
    const rel = relative(root, full);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`source manifest path escapes the repository: ${path}`);
    }
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(full));
    hash.update("\0");
  }
  return hash.digest("hex");
}
