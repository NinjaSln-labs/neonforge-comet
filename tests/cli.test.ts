import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { MockProvider } from "./helpers/mock-provider.ts";

test("headless CLI emits NDJSON and exits approval-required before a write", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-cli-workspace-"));
  const home = mkdtempSync(join(tmpdir(), "neonforge-cli-home-"));
  mock.enqueue({
    id: "turn-1",
    model: "deepseek-flash",
    choices: [
      {
        message: {
          content: "",
          reasoning_content: "Need approval.",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({ path: "blocked.txt", content: "no\n" })
              }
            }
          ]
        },
        finish_reason: "tool_calls"
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2 }
  });

  try {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "apps/cli/src/main.ts",
        "run",
        "write blocked.txt",
        "--workspace",
        workspace,
        "--json"
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEONFORGE_HOME: home,
          OPENAI_BASE_URL: baseUrl,
          OPENAI_API_KEY: "test-key",
          OPENAI_MODEL: "deepseek-flash"
        }
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on("close", resolve)
    );
    assert.equal(code, 3, stderr);
    const lines = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(lines.some((line) => line.type === "event"));
    assert.equal(lines.at(-1)?.type, "approval-required");
  } finally {
    await mock.stop();
  }
});

test("headless CLI completes a workspace-auto task with NDJSON result", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-cli-workspace-"));
  const home = mkdtempSync(join(tmpdir(), "neonforge-cli-home-"));
  mock.enqueue({
    id: "turn-1",
    model: "deepseek-flash",
    choices: [
      {
        message: {
          content: "",
          reasoning_content: "Write the file.",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({ path: "done.txt", content: "done\n" })
              }
            }
          ]
        },
        finish_reason: "tool_calls"
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2 }
  });
  mock.enqueue({
    id: "turn-2",
    model: "deepseek-flash",
    choices: [
      {
        message: { content: "Task complete.", reasoning_content: "Done." },
        finish_reason: "stop"
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2 }
  });

  try {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "apps/cli/src/main.ts",
        "run",
        "create done.txt",
        "--workspace",
        workspace,
        "--permission",
        "workspace-auto",
        "--json"
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEONFORGE_HOME: home,
          OPENAI_BASE_URL: baseUrl,
          OPENAI_API_KEY: "test-key",
          OPENAI_MODEL: "deepseek-v4-pro"
        }
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on("close", resolve)
    );
    assert.equal(code, 0, stderr);
    const lines = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const result = lines.at(-1);
    assert.equal(result.type, "result");
    assert.equal(result.content, "Task complete.");
    assert.equal(result.session.status, "completed");
    assert.equal(
      result.session.modelSelectionReason,
      "alias deepseek-v4-pro -> deepseek-flash"
    );
  } finally {
    await mock.stop();
  }
});
