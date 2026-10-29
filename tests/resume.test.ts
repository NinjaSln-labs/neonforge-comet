import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalRequiredError, SessionStore, runAgent } from "../packages/core/src/index.ts";
import { MockProvider } from "./helpers/mock-provider.ts";

test("resuming a waiting session preserves events and can complete", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-resume-workspace-"));
  const home = mkdtempSync(join(tmpdir(), "neonforge-resume-home-"));
  mock.enqueue({
    id: "turn-1",
    model: "deepseek-flash",
    choices: [
      {
        message: {
          content: "",
          reasoning_content: "Needs approval",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({ path: "x.txt", content: "x" })
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
    choices: [{ message: { content: "resumed complete" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 2 }
  });
  const store = new SessionStore(home);
  try {
    let sessionId = "";
    await assert.rejects(
      () =>
        runAgent({
          workspace,
          objective: "write x",
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
          thinkingEffort: "high",
          permissionMode: "balanced",
          store
        }),
      (error: unknown) => {
        if (error instanceof ApprovalRequiredError) sessionId = error.sessionId;
        return error instanceof ApprovalRequiredError;
      }
    );
    const before = store.events(sessionId);
    assert.ok(before.some((event) => event.kind === "approval.requested"));
    const result = await runAgent({
      workspace,
      objective: "write x",
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
      thinkingEffort: "high",
      permissionMode: "balanced",
      store,
      sessionId,
      resume: true,
      approve: async (request) => ({
        id: request.id,
        allowed: true,
        scope: "once"
      })
    });
    assert.equal(result.session.status, "completed");
    assert.ok(result.events.length > before.length);
    assert.ok(result.events.some((event) => event.kind === "approval.resumed"));
    assert.ok(result.events.some((event) => event.kind === "artifact.recorded"));
    assert.equal(readFileSync(join(workspace, "x.txt"), "utf8"), "x");
    const resumedMessages = mock.requests[1]?.body.messages as Array<
      Record<string, unknown>
    >;
    const toolMessage = resumedMessages.find((message) => message.role === "tool");
    assert.equal(toolMessage?.content, "Wrote x.txt");
  } finally {
    await mock.stop();
  }
});
