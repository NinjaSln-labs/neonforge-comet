import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root =
  "file:///workspace/neonforge-comet";
const { MockProvider } = await import(`${root}/tests/helpers/mock-provider.ts`);
const { SessionStore, runAgent } = await import(
  `${root}/packages/core/src/index.ts`
);

function provider(baseUrl: string) {
  return {
    id: "mock",
    name: "mock",
    baseUrl,
    protocol: "openai-chat" as const,
    model: "deepseek-flash"
  };
}

async function runWithToolCalls(
  toolCalls: Array<Record<string, unknown>>,
  permissionMode: "balanced" | "workspace-auto",
  approve: (request: { id: string; action: string }) => Promise<boolean>
) {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-probe-workspace-"));
  const home = mkdtempSync(join(tmpdir(), "neonforge-probe-home-"));
  writeFileSync(join(workspace, "README.md"), "hello\n");
  mock.enqueue({
    id: "turn-1",
    model: "deepseek-flash",
    choices: [
      {
        message: {
          content: "",
          reasoning_content: "Use requested tools.",
          tool_calls: toolCalls
        },
        finish_reason: "tool_calls"
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2 }
  });
  mock.enqueue({
    id: "turn-2",
    model: "deepseek-flash",
    choices: [{ message: { content: "finished" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 2 }
  });
  const result = await runAgent({
    workspace,
    objective: "exercise runtime approval paths",
    provider: provider(baseUrl),
    apiKey: "test",
    canonicalModel: "deepseek-flash",
    providerModel: "deepseek-flash",
    thinkingEffort: "low",
    permissionMode,
    store: new SessionStore(home),
    approve: async (request) => ({
      id: request.id,
      allowed: await approve(request),
      scope: "once"
    })
  });
  await mock.stop();
  return { result, workspace, requests: mock.requests };
}

const toolCall = (
  id: string,
  name: string,
  args: Record<string, unknown>
) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) }
});

const a1Approvals: string[] = [];
const a1 = await runWithToolCalls(
  [
    toolCall("call-read", "read_file", { path: "README.md" }),
    toolCall("call-write", "write_file", {
      path: "approved.txt",
      content: "write-approved"
    }),
    toolCall("call-command", "run_command", {
      command: "printf shell-approved > shell.txt"
    })
  ],
  "balanced",
  async (request) => {
    a1Approvals.push(request.action);
    return true;
  }
);
assert.deepEqual(a1Approvals, ["write", "command"]);
assert.equal(readFileSync(join(a1.workspace, "approved.txt"), "utf8"), "write-approved");
assert.equal(readFileSync(join(a1.workspace, "shell.txt"), "utf8"), "shell-approved");
assert.equal(a1.result.session.status, "completed");
assert.equal(a1.result.events.filter((event) => event.kind === "approval.decided").length, 2);
assert.ok(a1.result.events.some((event) => event.kind === "artifact.recorded"));
assert.ok(a1.result.events.some((event) => event.kind === "session.completed"));

const balancedApprovals: string[] = [];
const balanced = await runWithToolCalls(
  [
    toolCall("b-write", "write_file", { path: "blocked.txt", content: "no" }),
    toolCall("b-command", "run_command", { command: "printf no > command.txt" }),
    toolCall("b-network", "web_fetch", { url: "http://127.0.0.1:1/" })
  ],
  "balanced",
  async (request) => {
    balancedApprovals.push(request.action);
    return false;
  }
);
assert.deepEqual(balancedApprovals, ["write", "command", "network"]);
assert.equal(existsSync(join(balanced.workspace, "blocked.txt")), false);
assert.equal(existsSync(join(balanced.workspace, "command.txt")), false);
assert.equal(
  balanced.result.events.filter(
    (event) => event.kind === "approval.decided" && event.data.allowed === false
  ).length,
  3
);

const autoApprovals: string[] = [];
const auto = await runWithToolCalls(
  [
    toolCall("a-write", "write_file", { path: "automatic.txt", content: "yes" }),
    toolCall("a-command", "run_command", { command: "printf no > command.txt" }),
    toolCall("a-network", "web_fetch", { url: "http://127.0.0.1:1/" })
  ],
  "workspace-auto",
  async (request) => {
    autoApprovals.push(request.action);
    return false;
  }
);
assert.deepEqual(autoApprovals, ["command", "network"]);
assert.equal(readFileSync(join(auto.workspace, "automatic.txt"), "utf8"), "yes");
assert.equal(existsSync(join(auto.workspace, "command.txt")), false);
const automaticWrite = auto.result.events.find(
  (event) =>
    event.kind === "approval.decided" &&
    event.data.toolCallId === "a-write"
);
assert.equal(automaticWrite?.data.automatic, true);
assert.equal(automaticWrite?.data.policy, "workspace-auto");
assert.equal(automaticWrite?.data.scope, "session");
assert.equal(automaticWrite?.data.allowed, true);
assert.equal(
  auto.result.events.filter(
    (event) =>
      event.kind === "approval.decided" &&
      event.data.automatic === false &&
      event.data.allowed === false &&
      event.data.policy === "workspace-auto"
  ).length,
  2
);

console.log(
  JSON.stringify(
    {
      A1: {
        approvals: a1Approvals,
        writeCreated: true,
        shellCreated: true,
        artifactRecorded: true,
        completed: a1.result.session.status
      },
      A8: {
        balancedApprovals,
        balancedDeniedAll: true,
        workspaceAutoCallbackApprovals: autoApprovals,
        automaticWrite: {
          allowed: automaticWrite?.data.allowed,
          scope: automaticWrite?.data.scope,
          policy: automaticWrite?.data.policy,
          automatic: automaticWrite?.data.automatic
        },
        workspaceAutoExplicitDenials: 2
      }
    },
    null,
    2
  )
);
