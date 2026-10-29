import { buildStableSystemPrefix } from "../../deepseek/src/prompt.ts";
import {
  requiredCapabilitiesForObjective,
  resolveDeepSeekModel
} from "../../deepseek/src/model-registry.ts";
import {
  ProviderConfigurationError,
  validateProvider
} from "../../config/src/index.ts";
import {
  createAdapter,
  ProviderError,
  validateModelCapabilities,
  type ModelRequest
} from "../../protocols/src/index.ts";
import type {
  ApprovalDecision,
  ApprovalRequest,
  CapabilityName,
  ConversationMessage,
  RunOptions,
  SessionEvent,
  SessionRecord,
  ToolCall
} from "../../shared/src/types.ts";
import { redact } from "./redact.ts";
import { SessionStore } from "./session-store.ts";
import { executeTool, TOOL_DEFINITIONS } from "./tools.ts";

export class ApprovalRequiredError extends Error {
  readonly sessionId: string;
  readonly request: ApprovalRequest;

  constructor(sessionId: string, request: ApprovalRequest) {
    super(`Approval required for ${request.title}: ${request.detail}`);
    this.name = "ApprovalRequiredError";
    this.sessionId = sessionId;
    this.request = request;
  }
}

export class SessionCancelledError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super("Session cancelled");
    this.name = "SessionCancelledError";
    this.sessionId = sessionId;
  }
}

export interface AgentRunOptions extends RunOptions {
  store: SessionStore;
  approve?: (request: ApprovalRequest, session: SessionRecord) => Promise<ApprovalDecision>;
  signal?: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
  resume?: boolean;
  maxTurns?: number;
}

export interface AgentRunResult {
  session: SessionRecord;
  finalText: string;
  events: SessionEvent[];
}

export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  validateRunConfiguration(options);
  const store = options.store;
  const session = options.sessionId
    ? store.load(options.sessionId)
    : store.create({
        objective: options.objective,
        workspace: options.workspace,
        providerId: options.provider.id,
        protocol: options.provider.protocol,
        providerModel: options.providerModel,
        canonicalModel: options.canonicalModel,
        modelSelectionReason:
          options.modelSelectionReason ??
          `explicit canonical model ${options.canonicalModel}`,
        thinkingEffort: options.thinkingEffort,
        permissionMode: options.permissionMode
      });

  const emit = (event: SessionEvent) => {
    options.onEvent?.(event);
  };

  if (session.status === "completed" && !options.resume) {
    throw new Error(`Session ${session.id} is already completed.`);
  }

  store.setStatus(session.id, "running");
  const startsNewTurn = !options.resume || options.objective !== session.objective;
  if (startsNewTurn) {
    if (options.resume) store.update(session.id, { objective: options.objective });
    emit(store.append(session.id, "turn.started", { objective: options.objective }));
    emit(
      store.append(session.id, "user.message", {
        content: options.objective
      })
    );
  } else {
    emit(store.append(session.id, "turn.started", { resumed: true }));
  }
  emit(
    store.append(session.id, "model.selected", {
      providerModel: options.providerModel,
      canonicalModel: options.canonicalModel,
      reason:
        options.modelSelectionReason ??
        session.modelSelectionReason ??
        `explicit canonical model ${options.canonicalModel}`
    })
  );

  const messages: ConversationMessage[] = [
    { role: "system", content: buildStableSystemPrefix(TOOL_DEFINITIONS) },
    ...reconstructMessages(store.events(session.id))
  ];
  if (!messages.some((message) => message.role === "user")) {
    messages.push({ role: "user", content: session.objective });
  }

  const adapter = createAdapter(options.provider.protocol);
  const maxTurns = options.maxTurns ?? 24;
  let finalText = "";

  if (options.resume) {
    for (const call of unresolvedToolCalls(store.events(session.id))) {
      throwIfAborted(options.signal, session.id);
      await runToolCall({
        call,
        options,
        store,
        session,
        messages,
        emit
      });
    }
  }

  for (let turn = 0; turn < maxTurns; turn += 1) {
    throwIfAborted(options.signal, session.id);
    emit(
      store.append(session.id, "model.requested", {
        turn: turn + 1,
        provider: options.provider.id,
        protocol: options.provider.protocol,
        model: options.providerModel,
        canonicalModel: options.canonicalModel,
        selectionReason:
          options.modelSelectionReason ??
          session.modelSelectionReason ??
          `explicit canonical model ${options.canonicalModel}`,
        thinkingEffort: options.thinkingEffort
      })
    );

    let response;
    const startedAt = Date.now();
    try {
      const request: ModelRequest = {
        messages,
        tools: TOOL_DEFINITIONS,
        thinking: true,
        reasoningEffort: options.thinkingEffort,
        stream: options.stream ?? false,
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(options.signal ? { signal: options.signal } : {})
      };
      response = await adapter.complete(options.provider, options.apiKey, request);
    } catch (error) {
      if (options.signal?.aborted) {
        store.setStatus(session.id, "cancelled");
        emit(
          store.append(session.id, "session.cancelled", {
            reason: "cancelled during provider request"
          })
        );
        throw new SessionCancelledError(session.id);
      }
      const message = redact(error instanceof Error ? error.message : String(error));
      store.update(session.id, { status: "failed", lastError: message });
      emit(
        store.append(session.id, "model.failed", {
          message,
          providerError: error instanceof ProviderError
        })
      );
      emit(store.append(session.id, "session.failed", { message }));
      throw error;
    }

    store.addUsage(session.id, response.usage);
    emit(
      store.append(session.id, "model.completed", {
        content: response.content,
        reasoningContent: response.reasoningContent,
        toolCalls: response.toolCalls,
        usage: response.usage,
        finishReason: response.finishReason,
        providerRequestId: response.providerRequestId,
        providerModel: response.providerModel,
        latencyMs: Date.now() - startedAt
      })
    );
    messages.push({
      role: "assistant",
      content: response.content,
      ...(response.reasoningContent
        ? { reasoningContent: response.reasoningContent }
        : {}),
      ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {})
    });

    if (!response.toolCalls.length) {
      finalText = response.content;
      store.setStatus(session.id, "completed");
      emit(
        store.append(session.id, "session.completed", {
          content: finalText
        })
      );
      return { session: store.load(session.id), finalText, events: store.events(session.id) };
    }

    for (const call of response.toolCalls) {
      throwIfAborted(options.signal, session.id);
      await runToolCall({
        call,
        options,
        store,
        session,
        messages,
        emit
      });
    }
  }

  const message = `Agent loop limit (${maxTurns}) reached before completion.`;
  store.update(session.id, { status: "failed", lastError: message });
  emit(store.append(session.id, "session.failed", { message }));
  throw new Error(message);
}

interface ToolRunContext {
  call: ToolCall;
  options: AgentRunOptions;
  store: SessionStore;
  session: SessionRecord;
  messages: ConversationMessage[];
  emit: (event: SessionEvent) => void;
}

async function runToolCall(context: ToolRunContext): Promise<void> {
  const { call, options, store, session, messages, emit } = context;
  emit(
    store.append(session.id, "tool.requested", {
      id: call.id,
      name: call.name,
      arguments: call.arguments
    })
  );
  emit(store.append(session.id, "tool.started", { id: call.id, name: call.name }));
  const pendingApproval = findPendingApproval(store.events(session.id), call.id);

  const result = await executeTool(
    call.name,
    call.arguments,
    {
      workspace: session.workspace,
      permissionMode: options.permissionMode,
      approve: async (request) => {
        const effectiveRequest =
          pendingApproval?.id === request.id
            ? request
            : pendingApproval
              ? { ...request, id: pendingApproval.id }
              : request;
        if (pendingApproval) {
          emit(
            store.append(session.id, "approval.resumed", {
              request: effectiveRequest,
              toolCallId: call.id
            })
          );
        } else {
          emit(
            store.append(session.id, "approval.requested", {
              request: effectiveRequest,
              toolCallId: call.id
            })
          );
        }
        if (
          options.permissionMode === "workspace-auto" &&
          effectiveRequest.action === "write"
        ) {
          emit(
            store.append(session.id, "approval.decided", {
              id: effectiveRequest.id,
              allowed: true,
              reason: "workspace-auto policy",
              scope: "session",
              policy: "workspace-auto",
              automatic: true,
              toolCallId: call.id
            })
          );
          return true;
        }
        if (!options.approve) {
          store.setStatus(session.id, "waiting-approval");
          throw new ApprovalRequiredError(session.id, effectiveRequest);
        }
        try {
          const decision = await options.approve(
            effectiveRequest,
            store.load(session.id)
          );
          emit(
            store.append(session.id, "approval.decided", {
              id: decision.id,
              allowed: decision.allowed,
              reason: decision.reason,
              scope: decision.scope,
              policy:
                options.permissionMode === "workspace-auto"
                  ? "workspace-auto"
                  : "balanced",
              automatic: false,
              toolCallId: call.id
            })
          );
          store.setStatus(session.id, "running");
          return decision.allowed;
        } catch (error) {
          if (error instanceof ApprovalRequiredError) {
            store.setStatus(session.id, "waiting-approval");
          }
          throw error;
        }
      }
    },
    call.id
  );

  if (result.ok) {
    emit(
      store.append(session.id, "tool.completed", {
        toolCallId: result.toolCallId,
        name: result.name,
        content: result.content,
        metadata: result.metadata
      })
    );
    if (typeof result.metadata?.artifactPath === "string") {
      emit(
        store.append(session.id, "artifact.recorded", {
          path: result.metadata.artifactPath,
          bytes: result.metadata.bytes,
          operation: result.metadata.operation,
          diff: result.metadata.diff,
          toolCallId: result.toolCallId
        })
      );
    }
  } else {
    emit(
      store.append(session.id, "tool.failed", {
        toolCallId: result.toolCallId,
        name: result.name,
        content: result.content,
        metadata: result.metadata
      })
    );
  }
  messages.push({
    role: "tool",
    toolCallId: call.id,
    content: result.ok
      ? result.content
      : `TOOL_FAILED: ${result.content}`
  });
}

function validateRunConfiguration(options: AgentRunOptions): void {
  validateProvider(options.provider);
  if (!options.apiKey.trim()) {
    throw new ProviderConfigurationError(
      "API key is missing. Set NEONFORGE_API_KEY or OPENAI_API_KEY."
    );
  }
  const selection = resolveDeepSeekModel(options.providerModel);
  if (selection.canonical.id !== options.canonicalModel) {
    throw new ProviderConfigurationError(
      `Canonical model ${options.canonicalModel} does not match provider model ${options.providerModel}.`
    );
  }
  validateModelCapabilities(
    selection.canonical,
    options.provider.protocol,
    options.requiredCapabilities ??
      requiredCapabilitiesForObjective(options.objective)
  );
}

function unresolvedToolCalls(events: SessionEvent[]): ToolCall[] {
  const resolved = new Set<string>();
  let latestCalls: ToolCall[] = [];
  for (const event of events) {
    if (event.kind === "model.completed" && Array.isArray(event.data.toolCalls)) {
      latestCalls = event.data.toolCalls as ToolCall[];
    }
    if (
      event.kind === "tool.completed" ||
      event.kind === "tool.failed"
    ) {
      resolved.add(String(event.data.toolCallId ?? ""));
    }
  }
  return latestCalls.filter((call) => !resolved.has(call.id));
}

function findPendingApproval(
  events: SessionEvent[],
  toolCallId: string
): ApprovalRequest | undefined {
  let pending: ApprovalRequest | undefined;
  for (const event of events) {
    if (
      (event.kind === "approval.requested" ||
        event.kind === "approval.resumed") &&
      event.data.toolCallId === toolCallId &&
      event.data.request
    ) {
      pending = event.data.request as ApprovalRequest;
    }
    if (
      event.kind === "approval.decided" &&
      event.data.toolCallId === toolCallId
    ) {
      pending = undefined;
    }
  }
  return pending;
}

function reconstructMessages(events: SessionEvent[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const event of events) {
    if (event.kind === "user.message") {
      messages.push({ role: "user", content: String(event.data.content ?? "") });
    } else if (event.kind === "model.completed") {
      messages.push({
        role: "assistant",
        content: String(event.data.content ?? ""),
        ...(typeof event.data.reasoningContent === "string"
          ? { reasoningContent: event.data.reasoningContent }
          : {}),
        ...(Array.isArray(event.data.toolCalls)
          ? { toolCalls: event.data.toolCalls as ToolCall[] }
          : {})
      });
    } else if (
      event.kind === "tool.completed" ||
      event.kind === "tool.failed"
    ) {
      messages.push({
        role: "tool",
        toolCallId: String(event.data.toolCallId ?? ""),
        content: `${event.kind === "tool.failed" ? "TOOL_FAILED: " : ""}${String(
          event.data.content ?? ""
        )}`
      });
    }
  }
  return messages;
}

function throwIfAborted(signal: AbortSignal | undefined, sessionId: string): void {
  if (signal?.aborted) throw new SessionCancelledError(sessionId);
}
