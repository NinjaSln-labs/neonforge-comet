import type {
  ModelResponse,
  ProviderConfig,
  Usage
} from "../../shared/src/types.ts";
import { PROTOCOL_CAPABILITIES } from "./capabilities.ts";
import { joinVersionedUrl, postJson, postSse } from "./http.ts";
import {
  assertDeepSeekResponseModel,
  assertDeepSeekWireModel
} from "./model-guard.ts";
import type { ModelRequest, ProviderAdapter } from "./types.ts";

function buildBody(
  config: ProviderConfig,
  request: ModelRequest,
  stream: boolean
): Record<string, unknown> {
  const system = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const messages = request.messages
    .filter((message) => message.role !== "system")
    .map(toAnthropicMessage);
  return {
    model: config.model,
    max_tokens: request.maxOutputTokens ?? 8192,
    ...(system ? { system } : {}),
    messages,
    ...(request.tools.length
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters
          }))
        }
      : {}),
    ...(request.thinking
      ? {
          thinking: { type: "enabled" },
          output_config: { effort: request.reasoningEffort }
        }
      : {}),
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
    stream
  };
}

export class AnthropicMessagesAdapter implements ProviderAdapter {
  readonly protocol = "anthropic-messages" as const;
  readonly capabilities = PROTOCOL_CAPABILITIES["anthropic-messages"];

  async complete(
    config: ProviderConfig,
    apiKey: string,
    request: ModelRequest
  ): Promise<ModelResponse> {
    assertDeepSeekWireModel(config.model);
    const headers = {
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
      ...config.headers
    };
    if (!request.stream) {
      const response = await postJson(
        joinVersionedUrl(config.baseUrl, "v1/messages"),
        apiKey,
        buildBody(config, request, false),
        headers,
        request.signal,
        config.timeoutMs
      );
      return parseResponse(
        (await response.json()) as Record<string, any>,
        response.headers.get("request-id")
      );
    }

    const state = {
      content: "",
      reasoningContent: "",
      usage: {} as Usage,
      finishReason: undefined as string | undefined,
      providerRequestId: undefined as string | undefined,
      providerModel: undefined as string | undefined,
      toolBlocks: new Map<
        number,
        { id: string; name: string; arguments: string }
      >()
    };
    const streamResult = await postSse(
      joinVersionedUrl(config.baseUrl, "v1/messages"),
      apiKey,
      buildBody(config, request, true),
      (event) => {
        const type = String(event.type ?? "");
        if (type === "message_start") {
          const message = event.message as Record<string, any> | undefined;
          if (message?.id) state.providerRequestId = String(message.id);
          if (message?.model) {
            assertDeepSeekResponseModel(message.model);
            state.providerModel = String(message.model);
          }
          if (message?.usage) state.usage = normalizeUsage(message.usage);
          return;
        }
        if (type === "content_block_start") {
          const index = Number(event.index ?? 0);
          const block = event.content_block as Record<string, any> | undefined;
          if (block?.type === "tool_use") {
            state.toolBlocks.set(index, {
              id: String(block.id ?? `tool-${index}`),
              name: String(block.name ?? ""),
              arguments: String(block.input ? JSON.stringify(block.input) : "")
            });
          }
          return;
        }
        if (type === "content_block_delta") {
          const delta = event.delta as Record<string, any> | undefined;
          const index = Number(event.index ?? 0);
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            state.content += delta.text;
          } else if (
            delta?.type === "thinking_delta" &&
            typeof delta.thinking === "string"
          ) {
            state.reasoningContent += delta.thinking;
          } else if (
            delta?.type === "input_json_delta" &&
            typeof delta.partial_json === "string"
          ) {
            const current = state.toolBlocks.get(index);
            if (current) {
              state.toolBlocks.set(index, {
                ...current,
                arguments: current.arguments + delta.partial_json
              });
            }
          }
          return;
        }
        if (type === "message_delta") {
          const delta = event.delta as Record<string, any> | undefined;
          if (typeof delta?.stop_reason === "string") {
            state.finishReason = delta.stop_reason;
          }
          if (event.usage) {
            state.usage = { ...state.usage, ...normalizeUsage(event.usage) };
          }
        }
      },
      headers,
      request.signal,
      config.timeoutMs
    );
    state.providerRequestId ??= streamResult.requestId;
    return {
      content: state.content,
      ...(state.reasoningContent
        ? { reasoningContent: state.reasoningContent }
        : {}),
      toolCalls: [...state.toolBlocks.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, block]) => ({
          id: block.id,
          name: block.name,
          arguments: parseArguments(block.arguments)
        })),
      usage: state.usage,
      ...(state.finishReason ? { finishReason: state.finishReason } : {}),
      ...(state.providerRequestId
        ? { providerRequestId: state.providerRequestId }
        : {}),
      ...(state.providerModel ? { providerModel: state.providerModel } : {})
    };
  }
}

function parseResponse(
  body: Record<string, any>,
  responseRequestId?: string | null
): ModelResponse {
  assertDeepSeekResponseModel(body.model);
  const blocks = Array.isArray(body.content) ? body.content : [];
  const text: string[] = [];
  const reasoning: string[] = [];
  const toolCalls: ModelResponse["toolCalls"] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      text.push(block.text);
    }
    if (block.type === "thinking" && typeof block.thinking === "string") {
      reasoning.push(block.thinking);
    }
    if (block.type === "tool_use") {
      toolCalls.push({
        id: String(block.id),
        name: String(block.name),
        arguments:
          block.input && typeof block.input === "object" ? block.input : {}
      });
    }
  }
  return {
    content: text.join(""),
    ...(reasoning.length ? { reasoningContent: reasoning.join("") } : {}),
    toolCalls,
    usage: normalizeUsage(body.usage),
    finishReason: body.stop_reason,
    providerRequestId: responseRequestId ?? body.id,
    providerModel: body.model
  };
}

function normalizeUsage(value: any): Usage {
  const usage = value && typeof value === "object" ? value : {};
  return {
    ...(usage.input_tokens !== undefined
      ? { inputTokens: usage.input_tokens }
      : {}),
    ...(usage.output_tokens !== undefined
      ? { outputTokens: usage.output_tokens }
      : {}),
    ...(usage.cache_read_input_tokens !== undefined
      ? { cacheHitTokens: usage.cache_read_input_tokens }
      : {}),
    ...(usage.cache_creation_input_tokens !== undefined
      ? { cacheMissTokens: usage.cache_creation_input_tokens }
      : {})
  };
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toAnthropicMessage(message: ModelRequest["messages"][number]) {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content
        }
      ]
    };
  }
  if (message.role === "assistant") {
    const content: Array<Record<string, unknown>> = [];
    if (message.reasoningContent) {
      content.push({ type: "thinking", thinking: message.reasoningContent });
    }
    if (message.content) content.push({ type: "text", text: message.content });
    for (const call of message.toolCalls ?? []) {
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.arguments
      });
    }
    return { role: "assistant", content };
  }
  return { role: "user", content: message.content };
}
