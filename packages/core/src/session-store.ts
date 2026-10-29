import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  appendFileSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { ensureHome } from "../../config/src/index.ts";
import type {
  PermissionMode,
  Protocol,
  SessionEvent,
  SessionRecord,
  SessionStatus,
  ThinkingEffort,
  Usage
} from "../../shared/src/types.ts";

export interface CreateSessionInput {
  objective: string;
  workspace: string;
  providerId: string;
  protocol: Protocol;
  providerModel: string;
  canonicalModel: string;
  modelSelectionReason: string;
  thinkingEffort: ThinkingEffort;
  permissionMode: PermissionMode;
}

export class SessionStore {
  readonly root: string;

  constructor(root = ensureHome()) {
    this.root = join(root, "sessions");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  create(input: CreateSessionInput): SessionRecord {
    const now = new Date().toISOString();
    const id = `${now.replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
    const record: SessionRecord = {
      id,
      ...input,
      status: "created",
      createdAt: now,
      updatedAt: now,
      usage: {}
    };
    mkdirSync(this.sessionDir(id), { recursive: true, mode: 0o700 });
    writeFileSync(this.metaPath(id), `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600
    });
    writeFileSync(this.eventsPath(id), "", { mode: 0o600 });
    this.append(id, "session.created", {
      objective: input.objective,
      workspace: input.workspace,
      providerId: input.providerId,
      protocol: input.protocol,
      providerModel: input.providerModel,
      canonicalModel: input.canonicalModel,
      modelSelectionReason: input.modelSelectionReason,
      thinkingEffort: input.thinkingEffort,
      permissionMode: input.permissionMode
    });
    return record;
  }

  load(id: string): SessionRecord {
    return JSON.parse(readFileSync(this.metaPath(id), "utf8")) as SessionRecord;
  }

  update(id: string, patch: Partial<SessionRecord>): SessionRecord {
    const record = { ...this.load(id), ...patch, updatedAt: new Date().toISOString() };
    writeFileSync(this.metaPath(id), `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600
    });
    return record;
  }

  setStatus(id: string, status: SessionStatus): SessionRecord {
    return this.update(id, { status });
  }

  addUsage(id: string, usage: Usage): SessionRecord {
    const current = this.load(id).usage;
    return this.update(id, { usage: mergeUsage(current, usage) });
  }

  append(
    sessionId: string,
    kind: SessionEvent["kind"],
    data: Record<string, unknown>
  ): SessionEvent {
    const events = this.events(sessionId);
    const event: SessionEvent = {
      id: crypto.randomUUID(),
      sessionId,
      sequence: events.length + 1,
      timestamp: new Date().toISOString(),
      kind,
      data
    };
    appendFileSync(this.eventsPath(sessionId), `${JSON.stringify(event)}\n`, {
      mode: 0o600
    });
    return event;
  }

  events(sessionId: string): SessionEvent[] {
    const path = this.eventsPath(sessionId);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SessionEvent);
  }

  list(): SessionRecord[] {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          return this.load(entry.name);
        } catch {
          return undefined;
        }
      })
      .filter((record): record is SessionRecord => Boolean(record))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  paths(sessionId: string): { dir: string; meta: string; events: string } {
    return {
      dir: this.sessionDir(sessionId),
      meta: this.metaPath(sessionId),
      events: this.eventsPath(sessionId)
    };
  }

  private sessionDir(id: string): string {
    return join(this.root, id);
  }

  private metaPath(id: string): string {
    return join(this.sessionDir(id), "session.json");
  }

  private eventsPath(id: string): string {
    return join(this.sessionDir(id), "events.jsonl");
  }
}

function mergeUsage(a: Usage, b: Usage): Usage {
  const result: Usage = {};
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheHitTokens",
    "cacheMissTokens",
    "reasoningTokens"
  ] as const) {
    const value = (a[key] ?? 0) + (b[key] ?? 0);
    if (value > 0) result[key] = value;
  }
  return result;
}
