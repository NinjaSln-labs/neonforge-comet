import { spawn } from "node:child_process";
import {
  mkdirSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { sourceRevision } from "../lib/source-revision.mjs";

if (
  !process.env.OPENAI_BASE_URL ||
  !process.env.OPENAI_API_KEY ||
  !process.env.OPENAI_MODEL
) {
  console.error("Set OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL first.");
  process.exit(2);
}

const protocols = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages"
];
const anthropicBaseUrl =
  process.env.NEONFORGE_ANTHROPIC_BASE_URL?.trim() ||
  defaultAnthropicBaseUrl(process.env.OPENAI_BASE_URL);
const workspaceRevision = sourceRevision();
const outputDir = join(process.cwd(), "dist", "protocol-smoke");
mkdirSync(outputDir, { recursive: true });
const evidence = [];

for (const protocol of protocols) {
  const token = `${protocol}-EVIDENCE`;
  const generatedAt = new Date().toISOString();
  const providerBaseUrl =
    protocol === "anthropic-messages"
      ? anthropicBaseUrl
      : process.env.OPENAI_BASE_URL;
  const run = await runCli([
    "dist/neonforge.mjs",
    "run",
    `Reply with exactly ${token} and do not call any tools.`,
    "--workspace",
    ".",
    "--protocol",
    protocol,
    "--stream",
    "--json"
  ], providerBaseUrl);
  const result = parseResult(run.stdout);
  const passed =
    run.exitCode === 0 &&
    result?.session?.status === "completed" &&
    result?.session?.protocol === protocol &&
    result?.content === token;
  const record = {
    schema: "neonforge.protocol-smoke.v2",
    applicationVersion: "0.1.0",
    workspaceRevision,
    protocol,
    model: process.env.OPENAI_MODEL,
    providerBaseUrl,
    streaming: true,
    generatedAt,
    command:
      "neonforge run <token> --workspace . --protocol <protocol> --stream --json",
    exitCode: run.exitCode,
    passed,
    result,
    stderr: redact(run.stderr).slice(0, 2_000)
  };
  writeFileSync(
    join(outputDir, `${protocol}.json`),
    `${JSON.stringify(record, null, 2)}\n`
  );
  evidence.push(record);
  console.log(`${protocol}\t${passed ? "PASS" : "FAIL"}\t${result?.content ?? ""}`);
}

if (evidence.some((record) => !record.passed)) process.exit(1);

function runCli(args, providerBaseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, OPENAI_BASE_URL: providerBaseUrl }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) =>
      resolve({ exitCode: exitCode ?? 1, stdout, stderr })
    );
  });
}

function defaultAnthropicBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.hostname !== "api.deepseek.com") return baseUrl;
  url.pathname = "/anthropic";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parseResult(stdout) {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean)
    .at(-1);
}


function redact(value) {
  const secret = process.env.OPENAI_API_KEY;
  let redacted = String(value);
  if (secret) redacted = redacted.replaceAll(secret, "***");
  return redacted.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
}
