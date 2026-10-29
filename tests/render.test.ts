import test from "node:test";
import assert from "node:assert/strict";
import { renderEvent } from "../apps/cli/src/render.ts";
import type { SessionEvent } from "../packages/shared/src/types.ts";

function event(kind: SessionEvent["kind"], data: Record<string, unknown>): SessionEvent {
  return {
    id: crypto.randomUUID(),
    sessionId: "session-1",
    sequence: 1,
    timestamp: new Date().toISOString(),
    kind,
    data
  };
}

test("TUI renderer shows approvals, diffs, command output, usage, and outcome", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = (line: string) => stdout.push(line);
  const err = (line: string) => stderr.push(line);

  renderEvent(
    event("approval.requested", {
      request: { title: "Write file", detail: "README.md" }
    }),
    out,
    err
  );
  renderEvent(
    event("approval.decided", {
      allowed: true,
      scope: "session",
      policy: "workspace-auto",
      automatic: true
    }),
    out,
    err
  );
  renderEvent(
    event("tool.completed", {
      name: "write_file",
      content: "Wrote README.md",
      metadata: { diff: "--- a/README.md\n+++ b/README.md\n-old\n+new" }
    }),
    out,
    err
  );
  renderEvent(
    event("tool.completed", {
      name: "run_command",
      content: "command stdout",
      metadata: { stderr: "warning", exitCode: 0 }
    }),
    out,
    err
  );
  renderEvent(
    event("model.completed", {
      content: "answer",
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cacheHitTokens: 80,
        cacheMissTokens: 20,
        reasoningTokens: 4
      },
      latencyMs: 125,
      providerModel: "deepseek-flash"
    }),
    out,
    err
  );
  renderEvent(event("session.completed", { content: "answer" }), out, err);

  const text = stdout.join("\n");
  assert.match(text, /approval required/);
  assert.match(text, /automatic=true/);
  assert.match(text, /\[diff\]/);
  assert.match(text, /-old/);
  assert.match(text, /\+new/);
  assert.match(text, /command stdout/);
  assert.match(text, /cache=80\/20/);
  assert.match(text, /session\] completed/);
  assert.equal(stderr.length, 0);
});
