import { execFile } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  ApprovalRequest,
  PermissionMode,
  ToolDefinition,
  ToolResult
} from "../../shared/src/types.ts";
import { redact } from "./redact.ts";

const execFileAsync = promisify(execFile);

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_directory",
    description: "List files and directories inside the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      additionalProperties: false
    }
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file inside the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxBytes: { type: "number" }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "search_text",
    description: "Search text files in the workspace for a literal string.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "write_file",
    description: "Write complete UTF-8 content to a file inside the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"],
      additionalProperties: false
    }
  },
  {
    name: "apply_patch",
    description: "Replace one exact text block in a workspace file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" }
      },
      required: ["path", "oldText", "newText"],
      additionalProperties: false
    }
  },
  {
    name: "run_command",
    description: "Run a shell command with the workspace as its working directory.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "number" }
      },
      required: ["command"],
      additionalProperties: false
    }
  },
  {
    name: "web_fetch",
    description: "Fetch an HTTP(S) URL and return bounded text content.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        maxChars: { type: "number" }
      },
      required: ["url"],
      additionalProperties: false
    }
  }
];

export interface ToolContext {
  workspace: string;
  permissionMode: PermissionMode;
  approve(request: ApprovalRequest): Promise<boolean>;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
  toolCallId: string
): Promise<ToolResult> {
  try {
    if (name === "list_directory") {
      const path = safePath(context.workspace, stringArg(args, "path", "."));
      const entries = readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file"
      }));
      return ok(toolCallId, name, JSON.stringify(entries));
    }
    if (name === "read_file") {
      const path = safePath(context.workspace, stringArg(args, "path"));
      const maxBytes = numberArg(args, "maxBytes", 256_000);
      const content = readFileSync(path, "utf8");
      return ok(toolCallId, name, content.slice(0, maxBytes));
    }
    if (name === "search_text") {
      const query = stringArg(args, "query");
      const root = safePath(context.workspace, stringArg(args, "path", "."));
      const matches = searchText(root, realpathSync(context.workspace), query, 200);
      return ok(toolCallId, name, matches.join("\n"));
    }
    if (name === "write_file") {
      const path = safePath(context.workspace, stringArg(args, "path"));
      const content = stringArg(args, "content");
      if (!(await requireApproval(context, "write", `Write file`, path, args))) {
        return denied(toolCallId, name);
      }
      const before = readIfPresent(path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, { mode: 0o600 });
      const displayPath = relative(realpathSync(context.workspace), path);
      return ok(toolCallId, name, `Wrote ${displayPath}`, {
        artifactPath: displayPath,
        bytes: Buffer.byteLength(content),
        operation: "write",
        diff: unifiedDiff(displayPath, before, content)
      });
    }
    if (name === "apply_patch") {
      const path = safePath(context.workspace, stringArg(args, "path"));
      const oldText = stringArg(args, "oldText");
      const newText = stringArg(args, "newText");
      const current = readFileSync(path, "utf8");
      if (!current.includes(oldText)) {
        return fail(toolCallId, name, "The exact oldText block was not found.");
      }
      if (!(await requireApproval(context, "write", `Patch file`, path, args))) {
        return denied(toolCallId, name);
      }
      const next = current.replace(oldText, newText);
      writeFileSync(path, next, { mode: 0o600 });
      const displayPath = relative(realpathSync(context.workspace), path);
      return ok(toolCallId, name, `Patched ${displayPath}`, {
        artifactPath: displayPath,
        bytes: Buffer.byteLength(next),
        operation: "patch",
        diff: unifiedDiff(displayPath, current, next)
      });
    }
    if (name === "run_command") {
      const command = stringArg(args, "command");
      if (!(await requireApproval(context, "command", `Run command`, command, args))) {
        return denied(toolCallId, name);
      }
      const timeout = numberArg(args, "timeoutMs", 120_000);
      try {
        const result = await execFileAsync("bash", ["-lc", command], {
          cwd: context.workspace,
          timeout,
          maxBuffer: 2_000_000,
          env: sanitizedEnv()
        });
        return ok(toolCallId, name, redact(result.stdout), {
          stderr: redact(result.stderr),
          exitCode: 0
        });
      } catch (error) {
        const output = error as { stdout?: string; stderr?: string; code?: number };
        return fail(
          toolCallId,
          name,
          redact(output.stdout ?? ""),
          redact(output.stderr ?? String(error)),
          { exitCode: output.code ?? 1 }
        );
      }
    }
    if (name === "web_fetch") {
      const url = stringArg(args, "url");
      if (!(await requireApproval(context, "network", "Fetch URL", url, args))) {
        return denied(toolCallId, name);
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const text = await response.text();
      const maxChars = numberArg(args, "maxChars", 20_000);
      return ok(toolCallId, name, redact(text.slice(0, maxChars)), {
        status: response.status,
        contentType: response.headers.get("content-type")
      });
    }
    return fail(toolCallId, name, `Unknown tool: ${name}`);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "ApprovalRequiredError" || error.name === "SessionCancelledError")
    ) {
      throw error;
    }
    return fail(toolCallId, name, redact(error instanceof Error ? error.message : String(error)));
  }
}

export function safePath(workspace: string, path: string): string {
  const root = realpathSync(workspace);
  const candidate = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${path}`);
  }
  let ancestor = candidate;
  while (!exists(ancestor)) ancestor = dirname(ancestor);
  const realParent = realpathSync(ancestor);
  const parentRel = relative(root, realParent);
  if (parentRel.startsWith("..") || isAbsolute(parentRel)) {
    throw new Error(`Path escapes workspace through a symlink: ${path}`);
  }
  return candidate;
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function requireApproval(
  context: ToolContext,
  action: ApprovalRequest["action"],
  title: string,
  detail: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  return context.approve({
    id: crypto.randomUUID(),
    action,
    title,
    detail,
    payload
  });
}

function readIfPresent(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function unifiedDiff(
  path: string,
  before: string,
  after: string,
  maxLines = 2_000
): string {
  if (before === after) return "";
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  if (oldLines.length > maxLines || newLines.length > maxLines) {
    return `--- a/${path}\n+++ b/${path}\n@@ file changed (${oldLines.length} -> ${newLines.length} lines; diff omitted) @@\n`;
  }
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const output = [`--- a/${path}`, `+++ b/${path}`];
  let oldIndex = 0;
  let newIndex = 0;
  for (const match of [...lcs, { oldIndex: oldLines.length, newIndex: newLines.length }]) {
    while (oldIndex < match.oldIndex) {
      output.push(`-${oldLines[oldIndex] ?? ""}`);
      oldIndex += 1;
    }
    while (newIndex < match.newIndex) {
      output.push(`+${newLines[newIndex] ?? ""}`);
      newIndex += 1;
    }
    if (match.oldIndex < oldLines.length || match.newIndex < newLines.length) {
      output.push(` ${oldLines[match.oldIndex] ?? ""}`);
      oldIndex += 1;
      newIndex += 1;
    }
  }
  return `${output.join("\n")}\n`;
}

function longestCommonSubsequence(
  oldLines: string[],
  newLines: string[]
): Array<{ oldIndex: number; newIndex: number }> {
  const rows = oldLines.length + 1;
  const columns = newLines.length + 1;
  const lengths = Array.from({ length: rows }, () => new Uint16Array(columns));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      lengths[oldIndex]![newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? lengths[oldIndex + 1]![newIndex + 1]! + 1
          : Math.max(
              lengths[oldIndex + 1]![newIndex]!,
              lengths[oldIndex]![newIndex + 1]!
            );
    }
  }
  const result: Array<{ oldIndex: number; newIndex: number }> = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      result.push({ oldIndex, newIndex });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      lengths[oldIndex + 1]![newIndex]! >= lengths[oldIndex]![newIndex + 1]!
    ) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }
  return result;
}

function searchText(root: string, workspace: string, query: string, limit: number): string[] {
  const results: string[] = [];
  const walk = (dir: string) => {
    if (results.length >= limit) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.match(/\.(?:ts|tsx|js|json|md|txt|yaml|yml|toml)$/)) {
        try {
          const lines = readFileSync(full, "utf8").split("\n");
          lines.forEach((line, index) => {
            if (line.includes(query) && results.length < limit) {
              results.push(`${relative(workspace, full)}:${index + 1}: ${line.slice(0, 240)}`);
            }
          });
        } catch {
          // Ignore unreadable files in search results.
        }
      }
    }
  };
  walk(root);
  return results;
}

function stringArg(
  args: Record<string, unknown>,
  key: string,
  fallback?: string
): string {
  const value = args[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing string argument: ${key}`);
}

function numberArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  return typeof args[key] === "number" ? (args[key] as number) : fallback;
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/api[_-]?key|token|secret|credential/i.test(key)
    )
  );
}

function ok(
  toolCallId: string,
  name: string,
  content: string,
  metadata?: Record<string, unknown>
): ToolResult {
  return { toolCallId, name, ok: true, content, ...(metadata ? { metadata } : {}) };
}

function fail(
  toolCallId: string,
  name: string,
  message: string,
  stderr?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  return {
    toolCallId,
    name,
    ok: false,
    content: message,
    ...(stderr || metadata
      ? { metadata: { ...(stderr ? { stderr } : {}), ...(metadata ?? {}) } }
      : {})
  };
}

function denied(toolCallId: string, name: string): ToolResult {
  return {
    toolCallId,
    name,
    ok: false,
    content: "Action denied by the user.",
    metadata: { denied: true }
  };
}
