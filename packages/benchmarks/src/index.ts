import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export type BaselineStatus = "confirmed" | "staged" | "unavailable";

export interface BaselineSource {
  url: string;
  publisher: string;
  retrievedAt: string;
  title: string;
}

export interface BaselineLocalFile {
  path: string;
  sha256: string;
  bytes: number;
  mediaType: string;
  role: string;
}

export interface BaselineEntry {
  id: string;
  kind: "model-quality" | "harness-score" | "efficiency";
  status: BaselineStatus;
  canonical: boolean;
  publisher: string;
  benchmarkVersion: string;
  canonicalModel: string;
  modelVersion: string;
  retrievalDate: string;
  methodology: string;
  sources: BaselineSource[];
  localFiles: BaselineLocalFile[];
  normalizedPath?: string;
  normalizedHash?: string;
  adapterPath?: string;
  integrityHash?: string;
  notes?: string;
}

export interface BaselineCandidate {
  id: string;
  status: "staged";
  suite: string;
  sourceUrl: string;
  method: string;
  whyRelevant: string;
  requiredData: string[];
  notes?: string;
}

export interface BaselineRegistry {
  schema: "neonforge.baseline-registry.v1";
  version: number;
  updatedAt: string;
  entries: BaselineEntry[];
  candidates: BaselineCandidate[];
}

export interface VerificationIssue {
  code: string;
  message: string;
  entryId?: string;
  path?: string;
}

export interface VerificationResult {
  ok: boolean;
  checkedAt: string;
  issues: VerificationIssue[];
  registry: BaselineRegistry;
}

const REGISTRY_PATH = "benchmarks/registry.json";
const HASH = /^[a-f0-9]{64}$/;

export function registryPath(root = process.cwd()): string {
  return resolve(root, REGISTRY_PATH);
}

export function loadBaselineRegistry(root = process.cwd()): BaselineRegistry {
  return JSON.parse(readFileSync(registryPath(root), "utf8")) as BaselineRegistry;
}

export function listBaselineEntries(root = process.cwd()): BaselineEntry[] {
  return loadBaselineRegistry(root).entries;
}

export function showBaselineEntry(
  id: string,
  root = process.cwd()
): BaselineEntry {
  const entry = listBaselineEntries(root).find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Baseline entry "${id}" was not found.`);
  return entry;
}

export function verifyBaselineRegistry(root = process.cwd()): VerificationResult {
  const issues: VerificationIssue[] = [];
  let registry: BaselineRegistry;
  try {
    registry = loadBaselineRegistry(root);
  } catch (error) {
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      issues: [
        {
          code: "registry-unreadable",
          message: error instanceof Error ? error.message : String(error)
        }
      ],
      registry: {
        schema: "neonforge.baseline-registry.v1",
        version: 0,
        updatedAt: "",
        entries: [],
        candidates: []
      }
    };
  }

  if (registry.schema !== "neonforge.baseline-registry.v1") {
    add(issues, "schema", "Registry schema is invalid.");
  }
  if (!Number.isSafeInteger(registry.version) || registry.version < 1) {
    add(issues, "version", "Registry version must be a positive integer.");
  }
  if (!isIsoDate(registry.updatedAt)) {
    add(issues, "updatedAt", "Registry updatedAt must be an ISO timestamp.");
  }
  if (!Array.isArray(registry.entries) || registry.entries.length === 0) {
    add(issues, "entries", "Registry must contain at least one entry.");
  }
  if (!Array.isArray(registry.candidates)) {
    add(issues, "candidates", "Registry candidates must be an array.");
  }

  const IDs = new Set<string>();
  for (const entry of registry.entries ?? []) {
    validateEntry(root, entry, IDs, issues);
  }
  for (const candidate of registry.candidates ?? []) {
    validateCandidate(candidate, IDs, issues);
  }

  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    issues,
    registry
  };
}

function validateEntry(
  root: string,
  entry: BaselineEntry,
  ids: Set<string>,
  issues: VerificationIssue[]
): void {
  if (!entry || typeof entry !== "object") {
    add(issues, "entry", "Registry entry must be an object.");
    return;
  }
  for (const field of [
    "id",
    "publisher",
    "benchmarkVersion",
    "canonicalModel",
    "modelVersion",
    "retrievalDate",
    "methodology"
  ] as const) {
    if (typeof entry[field] !== "string" || !entry[field].trim()) {
      add(issues, "entry-field", `Entry field ${field} is required.`, entry.id);
    }
  }
  if (ids.has(entry.id)) {
    add(issues, "duplicate-id", `Duplicate baseline id ${entry.id}.`, entry.id);
  }
  ids.add(entry.id);
  if (!["confirmed", "staged", "unavailable"].includes(entry.status)) {
    add(issues, "status", `Entry ${entry.id} has invalid status.`, entry.id);
  }
  if (!["model-quality", "harness-score", "efficiency"].includes(entry.kind)) {
    add(issues, "kind", `Entry ${entry.id} has invalid kind.`, entry.id);
  }
  if (entry.canonical && entry.status !== "confirmed") {
    add(
      issues,
      "canonical-status",
      `Entry ${entry.id} cannot be canonical unless confirmed.`,
      entry.id
    );
  }
  if (entry.status === "confirmed" && !isIsoDate(entry.retrievalDate)) {
    add(issues, "retrievalDate", `Entry ${entry.id} has invalid retrievalDate.`, entry.id);
  }
  if (
    entry.integrityHash !== undefined &&
    !HASH.test(entry.integrityHash)
  ) {
    add(issues, "integrityHash", `Entry ${entry.id} has invalid integrityHash.`, entry.id);
  }
  if (entry.status === "confirmed" && !entry.integrityHash) {
    add(
      issues,
      "integrityHash",
      `Confirmed entry ${entry.id} requires an integrityHash.`,
      entry.id
    );
  }
  if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
    add(issues, "sources", `Entry ${entry.id} requires at least one source.`, entry.id);
  } else {
    for (const source of entry.sources) {
      if (!isHttps(source.url)) {
        add(issues, "source-url", `Entry ${entry.id} has a non-HTTPS source.`, entry.id);
      }
      if (!isIsoDate(source.retrievedAt)) {
        add(issues, "source-date", `Entry ${entry.id} has an invalid source date.`, entry.id);
      }
    }
  }
  if (entry.status === "confirmed" && !entry.localFiles?.length) {
    add(issues, "localFiles", `Confirmed entry ${entry.id} requires local files.`, entry.id);
  }
  for (const file of entry.localFiles ?? []) {
    validateFile(root, entry.id, file, issues);
  }
  if (entry.normalizedPath) {
    const normalized = validatePath(root, entry.id, entry.normalizedPath, issues);
    if (normalized && entry.normalizedHash) {
      const hash = sha256(normalized);
      if (hash !== entry.normalizedHash) {
        add(
          issues,
          "normalized-hash",
          `Normalized file hash mismatch for ${entry.normalizedPath}.`,
          entry.id,
          entry.normalizedPath
        );
      }
    }
  }
  if (entry.adapterPath) {
    validatePath(root, entry.id, entry.adapterPath, issues);
  }
  if (entry.id === "bug-hunt-bench-2026-10-27") {
    if (!entry.adapterPath) {
      add(issues, "adapter", "Bug Hunt Bench requires an adapter path.", entry.id);
    }
    if (entry.status === "confirmed" && entry.canonical) {
      add(
        issues,
        "score-claim",
        "Bug Hunt Bench snapshot must not be marked as a measured NeonForge score in V1.",
        entry.id
      );
    }
  }
}

function validateCandidate(
  candidate: BaselineCandidate,
  ids: Set<string>,
  issues: VerificationIssue[]
): void {
  if (!candidate || typeof candidate !== "object") {
    add(issues, "candidate", "Candidate must be an object.");
    return;
  }
  if (candidate.status !== "staged") {
    add(issues, "candidate-status", `Candidate ${candidate.id} must be staged.`, candidate.id);
  }
  if (ids.has(candidate.id)) {
    add(issues, "duplicate-id", `Duplicate baseline id ${candidate.id}.`, candidate.id);
  }
  ids.add(candidate.id);
  if (!isHttps(candidate.sourceUrl)) {
    add(issues, "candidate-url", `Candidate ${candidate.id} has a non-HTTPS source.`, candidate.id);
  }
  if (!candidate.suite?.trim() || !candidate.method?.trim()) {
    add(issues, "candidate-fields", `Candidate ${candidate.id} is incomplete.`, candidate.id);
  }
  if (!Array.isArray(candidate.requiredData) || candidate.requiredData.length === 0) {
    add(
      issues,
      "candidate-data",
      `Candidate ${candidate.id} must list required data.`,
      candidate.id
    );
  }
}

function validateFile(
  root: string,
  entryId: string,
  file: BaselineLocalFile,
  issues: VerificationIssue[]
): void {
  const path = validatePath(root, entryId, file.path, issues);
  if (!path) return;
  const bytes = statSync(path).size;
  if (bytes !== file.bytes) {
    add(issues, "file-size", `File size mismatch for ${file.path}.`, entryId, file.path);
  }
  if (sha256(path) !== file.sha256) {
    add(issues, "file-hash", `File hash mismatch for ${file.path}.`, entryId, file.path);
  }
}

function validatePath(
  root: string,
  entryId: string,
  path: string,
  issues: VerificationIssue[]
): string | undefined {
  if (isAbsolute(path)) {
    add(issues, "relative-path", `Path must be relative: ${path}.`, entryId, path);
    return undefined;
  }
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    add(issues, "path-escape", `Path escapes the repository: ${path}.`, entryId, path);
    return undefined;
  }
  if (!existsSync(full) || !statSync(full).isFile()) {
    add(issues, "missing-file", `File is missing: ${path}.`, entryId, path);
    return undefined;
  }
  return full;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isHttps(value: string | undefined): boolean {
  try {
    return new URL(value ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDate(value: string | undefined): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function add(
  issues: VerificationIssue[],
  code: string,
  message: string,
  entryId?: string,
  path?: string
): void {
  issues.push({
    code,
    message,
    ...(entryId ? { entryId } : {}),
    ...(path ? { path } : {})
  });
}
