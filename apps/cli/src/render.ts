import type { SessionEvent } from "../../../packages/shared/src/types.ts";

type Writer = (message: string) => void;

export function renderEvent(
  event: SessionEvent,
  stdout: Writer = console.log,
  stderr: Writer = console.error
): void {
  switch (event.kind) {
    case "model.selected":
      stdout(
        `\n[model] ${String(event.data.providerModel)} -> ${String(
          event.data.canonicalModel
        )} (${String(event.data.reason)})`
      );
      break;
    case "model.completed": {
      const content = String(event.data.content ?? "");
      if (content) stdout(`\nassistant > ${content}`);
      stdout(`[usage] ${formatUsage(event.data)}`);
      break;
    }
    case "model.failed":
      stderr(`[model error] ${String(event.data.message ?? "")}`);
      break;
    case "approval.requested": {
      const request = event.data.request as
        | { title?: string; detail?: string }
        | undefined;
      stdout(`\n[approval required] ${request?.title ?? "action"}`);
      if (request?.detail) stdout(request.detail);
      break;
    }
    case "approval.resumed": {
      const request = event.data.request as
        | { title?: string; detail?: string }
        | undefined;
      stdout(`\n[approval resumed] ${request?.title ?? "pending action"}`);
      if (request?.detail) stdout(request.detail);
      break;
    }
    case "approval.decided":
      stdout(
        `[approval] ${event.data.allowed ? "allowed" : "denied"} ` +
          `scope=${String(event.data.scope ?? "once")} ` +
          `policy=${String(event.data.policy ?? "balanced")}` +
          (event.data.automatic ? " automatic=true" : "")
      );
      break;
    case "tool.started":
      stdout(`\n[tool] ${String(event.data.name)} started`);
      break;
    case "tool.completed":
      renderToolCompleted(event, stdout);
      break;
    case "tool.failed":
      stderr(
        `[tool failed] ${String(event.data.name)}: ${String(
          event.data.content ?? "unknown error"
        )}`
      );
      break;
    case "artifact.recorded":
      stdout(
        `[artifact] ${String(event.data.path)} ${String(
          event.data.bytes ?? 0
        )} bytes`
      );
      break;
    case "session.completed":
      stdout(`\n[session] completed`);
      break;
    case "session.failed":
      stderr(`[session] failed: ${String(event.data.message ?? "")}`);
      break;
    case "session.cancelled":
      stderr(`[session] cancelled: ${String(event.data.reason ?? "")}`);
      break;
    default:
      break;
  }
}

function renderToolCompleted(event: SessionEvent, stdout: Writer): void {
  const name = String(event.data.name ?? "tool");
  const content = String(event.data.content ?? "");
  const metadata = (event.data.metadata ?? {}) as Record<string, unknown>;
  const diff = typeof metadata.diff === "string" ? metadata.diff : "";
  if (diff) {
    stdout(`\n[diff] ${name}\n${diff.trimEnd()}`);
    return;
  }
  if (name === "run_command") {
    if (content) stdout(`\n[command output]\n${content.trimEnd()}`);
    if (typeof metadata.exitCode === "number") {
      stdout(`[exit] ${metadata.exitCode}`);
    }
    if (typeof metadata.stderr === "string" && metadata.stderr) {
      stdout(`[stderr]\n${metadata.stderr.trimEnd()}`);
    }
    return;
  }
  if (name === "web_fetch") {
    stdout(`\n[fetch output]\n${content.slice(0, 2_000).trimEnd()}`);
    return;
  }
  stdout(`[tool] ${name} completed`);
}

function formatUsage(data: Record<string, unknown>): string {
  const usage = (data.usage ?? {}) as Record<string, unknown>;
  const parts = [
    `input=${number(usage.inputTokens)}`,
    `output=${number(usage.outputTokens)}`,
    `cache=${number(usage.cacheHitTokens)}/${number(usage.cacheMissTokens)}`,
    `reasoning=${number(usage.reasoningTokens)}`
  ];
  if (typeof data.latencyMs === "number") {
    parts.push(`latency=${data.latencyMs}ms`);
  }
  if (typeof data.providerModel === "string") {
    parts.push(`model=${data.providerModel}`);
  }
  return parts.join(" ");
}

function number(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
