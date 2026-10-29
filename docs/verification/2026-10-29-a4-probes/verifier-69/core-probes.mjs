import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = "/workspace/neonforge-comet";
const { SessionStore, runAgent, redact } = await import(
  `${repo}/packages/core/src/index.ts`
);

const responses = [];
const requests = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  requests.push(body);
  const next = responses.shift();
  if (!next) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "probe response queue empty" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: `probe-${requests.length}`,
      model: "deepseek-flash",
      usage: { prompt_tokens: 10, completion_tokens: 2 },
      ...next
    })
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

function provider() {
  return {
    id: "independent-core-probe",
    name: "Independent core probe",
    baseUrl,
    protocol: "openai-chat",
    model: "deepseek-flash"
  };
}
function toolResponse(calls) {
  return {
    choices: [
      {
        message: {
          content: "",
          reasoning_content: "Use the requested tools.",
          tool_calls: calls.map((call, index) => ({
            id: `call-${index + 1}`,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments)
            }
          }))
        },
        finish_reason: "tool_calls"
      }
    ]
  };
}
function finalResponse(text) {
  return {
    choices: [
      {
        message: { content: text, reasoning_content: "Finished." },
        finish_reason: "stop"
      }
    ]
  };
}

const output = {};
try {
  const workspace = mkdtempSync(join(tmpdir(), "neonforge-a1-workspace-"));
  const home = mkdtempSync(join(tmpdir(), "neonforge-a1-home-"));
  writeFileSync(join(workspace, "README.md"), "approved task\n");
  responses.push(
    toolResponse([
      { name: "read_file", arguments: { path: "README.md" } },
      {
        name: "write_file",
        arguments: { path: "approved.txt", content: "written by tool" }
      },
      {
        name: "run_command",
        arguments: { command: "printf shell-ok > shell.txt" }
      }
    ]),
    finalResponse("A1 complete")
  );
  const approvals = [];
  const a1 = await runAgent({
    workspace,
    objective: "read README.md, write approved.txt, and run the requested shell command",
    provider: provider(),
    apiKey: "test-key",
    canonicalModel: "deepseek-flash",
    providerModel: "deepseek-flash",
    modelSelectionReason: "explicit canonical model deepseek-flash",
    thinkingEffort: "high",
    permissionMode: "balanced",
    store: new SessionStore(home),
    approve: async (request) => {
      approvals.push(request.action);
      return { id: request.id, allowed: true, scope: "once" };
    }
  });
  assert.equal(readFileSync(join(workspace, "approved.txt"), "utf8"), "written by tool");
  assert.equal(readFileSync(join(workspace, "shell.txt"), "utf8"), "shell-ok");
  assert.deepEqual(approvals, ["write", "command"]);
  assert.equal(a1.session.status, "completed");
  assert.ok(a1.events.some((event) => event.kind === "artifact.recorded"));
  assert.ok(
    a1.events.some(
      (event) =>
        event.kind === "tool.completed" &&
        event.data.name === "read_file" &&
        event.data.content === "approved task\n"
    )
  );
  assert.ok(
    a1.events.some(
      (event) =>
        event.kind === "tool.completed" &&
        event.data.name === "run_command" &&
        event.data.metadata?.exitCode === 0
    )
  );
  assert.equal(requests[1].messages.filter((message) => message.role === "tool").length, 3);
  output.a1 = {
    approvals,
    files: ["approved.txt", "shell.txt"],
    artifactRecorded: true,
    completed: true
  };

  const autoWorkspace = mkdtempSync(join(tmpdir(), "neonforge-a8-workspace-"));
  const autoHome = mkdtempSync(join(tmpdir(), "neonforge-a8-home-"));
  responses.push(
    toolResponse([
      {
        name: "write_file",
        arguments: { path: "auto.txt", content: "automatic" }
      },
      {
        name: "run_command",
        arguments: { command: "printf denied > denied.txt" }
      },
      {
        name: "web_fetch",
        arguments: { url: "http://127.0.0.1:1/must-not-be-fetched" }
      }
    ]),
    finalResponse("A8 complete")
  );
  const manualApprovals = [];
  const a8 = await runAgent({
    workspace: autoWorkspace,
    objective: "write, run a command, and fetch a URL",
    provider: provider(),
    apiKey: "test-key",
    canonicalModel: "deepseek-flash",
    providerModel: "deepseek-flash",
    modelSelectionReason: "explicit canonical model deepseek-flash",
    thinkingEffort: "high",
    permissionMode: "workspace-auto",
    store: new SessionStore(autoHome),
    approve: async (request) => {
      manualApprovals.push({
        action: request.action,
        title: request.title,
        detail: request.detail
      });
      return {
        id: request.id,
        allowed: false,
        scope: "once",
        reason: "independent verifier denied"
      };
    }
  });
  assert.equal(readFileSync(join(autoWorkspace, "auto.txt"), "utf8"), "automatic");
  assert.equal(existsSync(join(autoWorkspace, "denied.txt")), false);
  assert.deepEqual(
    manualApprovals.map((request) => request.action),
    ["command", "network"]
  );
  const decisions = a8.events
    .filter((event) => event.kind === "approval.decided")
    .map((event) => ({
      allowed: event.data.allowed,
      policy: event.data.policy,
      automatic: event.data.automatic,
      action:
        a8.events.find(
          (candidate) =>
            candidate.kind === "approval.requested" &&
            candidate.data.toolCallId === event.data.toolCallId
        )?.data.request?.action ?? "write"
    }));
  assert.deepEqual(decisions, [
    { allowed: true, policy: "workspace-auto", automatic: true, action: "write" },
    { allowed: false, policy: "workspace-auto", automatic: false, action: "command" },
    { allowed: false, policy: "workspace-auto", automatic: false, action: "network" }
  ]);
  assert.equal(a8.session.status, "completed");
  output.a8 = {
    automaticWrite: decisions[0],
    manualCommand: decisions[1],
    manualNetwork: decisions[2],
    commandSideEffectAbsent: true
  };

  const secretWorkspace = mkdtempSync(join(tmpdir(), "neonforge-a10-workspace-"));
  const secretHome = mkdtempSync(join(tmpdir(), "neonforge-a10-home-"));
  const secretValue = "test-value";
  process.env.OPENAI_API_KEY = secretValue;
  responses.push(
    toolResponse([
      {
        name: "run_command",
        arguments: { command: "printf '%s' \"$OPENAI_API_KEY\"" }
      }
    ]),
    finalResponse("A10 complete")
  );
  const a10 = await runAgent({
    workspace: secretWorkspace,
    objective: "exercise provider authentication and a secret-bearing command environment",
    provider: provider(),
    apiKey: secretValue,
    canonicalModel: "deepseek-flash",
    providerModel: "deepseek-flash",
    modelSelectionReason: "explicit canonical model deepseek-flash",
    thinkingEffort: "high",
    permissionMode: "balanced",
    store: new SessionStore(secretHome),
    approve: async (request) => ({
      id: request.id,
      allowed: true,
      scope: "once"
    })
  });
  const persisted = JSON.stringify({
    session: a10.session,
    events: a10.events
  });
  assert.equal(persisted.includes(secretValue), false);
  assert.equal(
    redact(`Authorization: Bearer ${secretValue}; api_key=${secretValue}`).includes(secretValue),
    false
  );
  const commandResult = a10.events.find(
    (event) =>
      event.kind === "tool.completed" && event.data.name === "run_command"
  );
  assert.equal(commandResult?.data.content, "");
  output.a10 = {
    secretInPersistedSession: false,
    secretInRedactedText: false,
    commandSawCredentialEnvironment: false
  };

  console.log(JSON.stringify(output, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
