import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import {
  requiredCapabilitiesForObjective,
  requireModel
} from "../packages/deepseek/src/index.ts";
import {
  UnsupportedCapabilityError,
  validateModelCapabilities
} from "../packages/protocols/src/index.ts";
import { SessionStore, runAgent } from "../packages/core/src/index.ts";
import { MockProvider } from "./helpers/mock-provider.ts";

test("capability validation rejects unsupported required capabilities", () => {
  assert.deepEqual(requiredCapabilitiesForObjective("read this screenshot"), [
    "vision"
  ]);
  assert.throws(
    () =>
      validateModelCapabilities(requireModel("deepseek-flash"), "openai-chat", [
        "vision"
      ]),
    UnsupportedCapabilityError
  );
  assert.doesNotThrow(() =>
    validateModelCapabilities(requireModel("deepseek-flash"), "openai-chat", [
      "thinking",
      "tools",
      "json"
    ])
  );
});

test("capability failure occurs before a model request or session creation", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  const home = mkdtempSync(join(tmpdir(), "neonforge-cap-home-"));
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-cap-workspace-"));
  const store = new SessionStore(home);
  try {
    await assert.rejects(
      () =>
        runAgent({
          workspace,
          objective: "inspect this screenshot",
          provider: {
            id: "mock",
            name: "Mock",
            baseUrl,
            protocol: "openai-chat",
            model: "deepseek-flash"
          },
          apiKey: "test",
          canonicalModel: "deepseek-flash",
          providerModel: "deepseek-flash",
          requiredCapabilities: ["vision"],
          thinkingEffort: "low",
          permissionMode: "balanced",
          store
        }),
      UnsupportedCapabilityError
    );
    assert.equal(mock.requests.length, 0);
    assert.equal(store.list().length, 0);
  } finally {
    await mock.stop();
  }
});

test("invalid provider URL fails before request and leaves no broken session", async () => {
  const home = mkdtempSync(join(tmpdir(), "neonforge-invalid-home-"));
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-invalid-workspace-"));
  const result = await runCli(
    [
      "run",
      "say hello",
      "--workspace",
      workspace,
      "--json"
    ],
    {
      ...process.env,
      NEONFORGE_HOME: home,
      OPENAI_BASE_URL: "http://example.com/v1",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "deepseek-flash"
    }
  );
  assert.equal(result.code, 4);
  assert.match(result.stderr, /HTTPS/);
  assert.equal(sessionCount(home), 0);
});

test("missing credential fails before request and leaves no broken session", async () => {
  const home = mkdtempSync(join(tmpdir(), "neonforge-missing-home-"));
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-missing-workspace-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEONFORGE_HOME: home,
    OPENAI_BASE_URL: "http://127.0.0.1:65534/v1",
    OPENAI_MODEL: "deepseek-flash"
  };
  delete env.OPENAI_API_KEY;
  delete env.NEONFORGE_API_KEY;
  const result = await runCli(
    ["run", "say hello", "--workspace", workspace, "--json"],
    env
  );
  assert.equal(result.code, 4);
  assert.match(result.stderr, /API key is missing/);
  assert.equal(sessionCount(home), 0);
});

function sessionCount(home: string): number {
  try {
    return readdirSync(join(home, "sessions")).length;
  } catch {
    return 0;
  }
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "apps/cli/src/main.ts", ...args],
      { cwd: process.cwd(), env }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
