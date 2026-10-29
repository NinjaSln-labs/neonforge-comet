import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ApprovalRequiredError,
  SessionStore,
  runAgent
} from "../packages/core/src/index.ts";
import type { ProviderConfig } from "../packages/shared/src/types.ts";
import { MockProvider } from "./helpers/mock-provider.ts";

function provider(baseUrl: string): ProviderConfig {
  return {
    id: "mock",
    name: "Mock",
    baseUrl,
    protocol: "openai-chat",
    model: "deepseek-flash"
  };
}

test("runs a tool loop, preserves reasoning_content, and writes evidence", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-workspace-"));
  const home = mkdtempSync(join(tmpdir(), "neonforge-home-"));
  writeFileSync(join(workspace, "README.md"), "hello\n");
  mock.enqueue({
    id: "turn-1",
    model: "deepseek-flash",
    choices: [
      {
        message: {
          content: "",
          reasoning_content: "Need to write a file.",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({ path: "result.txt", content: "done\n" })
              }
            }
          ]
        },
        finish_reason: "tool_calls"
      }
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_cache_hit_tokens: 70,
      prompt_cache_miss_tokens: 30
    }
  });
  mock.enqueue({
    id: "turn-2",
    model: "deepseek-flash",
    choices: [
      {
        message: { content: "Completed the task.", reasoning_content: "Done." },
        finish_reason: "stop"
      }
    ],
    usage: { prompt_tokens: 120, completion_tokens: 10 }
  });

  try {
    const result = await runAgent({
      workspace,
      objective: "create result.txt",
      provider: provider(baseUrl),
      apiKey: "test",
      canonicalModel: "deepseek-flash",
      providerModel: "deepseek-flash",
      modelSelectionReason: "auto selected deepseek-flash",
      thinkingEffort: "high",
      permissionMode: "balanced",
      store: new SessionStore(home),
      approve: async (request) => ({
        id: request.id,
        allowed: true,
        scope: "once"
      })
    });
    assert.equal(readFileSync(join(workspace, "result.txt"), "utf8"), "done\n");
    assert.equal(result.finalText, "Completed the task.");
    assert.equal(result.session.status, "completed");
    assert.equal(
      result.session.modelSelectionReason,
      "auto selected deepseek-flash"
    );
    assert.ok(result.events.some((event) => event.kind === "approval.decided"));
    assert.ok(
      result.events.some(
        (event) =>
          event.kind === "model.selected" &&
          event.data.reason === "auto selected deepseek-flash"
      )
    );
    assert.ok(result.events.some((event) => event.kind === "artifact.recorded"));
    const secondMessages = mock.requests[1]?.body.messages as Array<Record<string, unknown>>;
    const assistant = secondMessages.find((message) => message.role === "assistant");
    assert.equal(assistant?.reasoning_content, "Need to write a file.");
  } finally {
    await mock.stop();
  }
});

test("headless approval fails before executing a write and preserves pending session", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-workspace-"));
  const home = mkdtempSync(join(tmpdir(), "neonforge-home-"));
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
                arguments: JSON.stringify({ path: "denied.txt", content: "no\n" })
              }
            }
          ]
        },
        finish_reason: "tool_calls"
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2 }
  });
  const store = new SessionStore(home);
  try {
    await assert.rejects(
      () =>
        runAgent({
          workspace,
          objective: "write a file",
          provider: provider(baseUrl),
          apiKey: "test",
          canonicalModel: "deepseek-flash",
          providerModel: "deepseek-flash",
          thinkingEffort: "high",
          permissionMode: "balanced",
          store
        }),
      (error: unknown) => error instanceof ApprovalRequiredError
    );
    const session = store.list()[0];
    assert.equal(session?.status, "waiting-approval");
  } finally {
    await mock.stop();
  }
});

test("workspace-auto writes without approval but still gates commands", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-workspace-"));
  const home = mkdtempSync(join(tmpdir(), "neonforge-home-"));
  mock.enqueue({
    id: "turn-1",
    model: "deepseek-flash",
    choices: [
      {
        message: {
          content: "",
          reasoning_content: "write",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({ path: "auto.txt", content: "yes\n" })
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
    choices: [{ message: { content: "done" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 2 }
  });
  let approvals = 0;
  try {
    const result = await runAgent({
      workspace,
      objective: "write automatically",
      provider: provider(baseUrl),
      apiKey: "test",
      canonicalModel: "deepseek-flash",
      providerModel: "deepseek-flash",
      thinkingEffort: "low",
      permissionMode: "workspace-auto",
      store: new SessionStore(home),
      approve: async (request) => {
        approvals += 1;
        return { id: request.id, allowed: true, scope: "once" };
      }
    });
    assert.equal(approvals, 0);
    assert.equal(readFileSync(join(workspace, "auto.txt"), "utf8"), "yes\n");
    assert.ok(
      result.events.some(
        (event) =>
          event.kind === "approval.decided" &&
          event.data.automatic === true &&
          event.data.policy === "workspace-auto" &&
          event.data.allowed === true
      )
    );
  } finally {
    await mock.stop();
  }
});

test(
  "artifact paths stay workspace-relative through a symlinked workspace root",
  { skip: process.platform === "win32" },
  async () => {
    const mock = new MockProvider();
    const baseUrl = await mock.start();
    const realWorkspace = mkdtempSync(join(tmpdir(), "neonforge-real-workspace-"));
    const linkedWorkspace = join(
      tmpdir(),
      `neonforge-linked-workspace-${crypto.randomUUID()}`
    );
    symlinkSync(realWorkspace, linkedWorkspace, "dir");
    const home = mkdtempSync(join(tmpdir(), "neonforge-home-"));
    mock.enqueue({
      id: "turn-1",
      model: "deepseek-flash",
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({ path: "linked.txt", content: "ok\n" })
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
      choices: [{ message: { content: "done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2 }
    });
    try {
      const result = await runAgent({
        workspace: linkedWorkspace,
        objective: "write linked.txt",
        provider: provider(baseUrl),
        apiKey: "test",
        canonicalModel: "deepseek-flash",
        providerModel: "deepseek-flash",
        thinkingEffort: "low",
        permissionMode: "workspace-auto",
        store: new SessionStore(home)
      });
      const completed = result.events.find(
        (event) => event.kind === "tool.completed"
      );
      assert.equal(
        (completed?.data.metadata as Record<string, unknown> | undefined)
          ?.artifactPath,
        "linked.txt"
      );
    } finally {
      await mock.stop();
    }
  }
);
