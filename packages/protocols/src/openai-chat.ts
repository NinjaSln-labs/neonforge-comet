import type {
  ModelResponse,
  ProviderConfig,
  Usage
} from "../../shared/src/types.ts";
import { PROTOCOL_CAPABILITIES } from "./capabilities.ts";
import { joinUrl, postJson, postSse } from "./http.ts";
import {
  assertDeepSeekResponseModel,
  assertDeepSeekWireModel
} from "./model-guard.ts";
import type { ModelRequest, ProviderAdapter } from "./types.ts";

function toWireMessage(message: ModelRequest["messages"][number]) {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content
    };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.reasoningContent
        ? { reasoning_content: message.reasoningContent }
        : {}),
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments)
              }
            }))
          }
        : {})
    };
  }
  return { role: message.role, content: message.content };
}

function buildBody(
  config: ProviderConfig,
  request: ModelRequest,
  stream: boolean
): Record<string, unknown> {
  return {
    model: config.model,
    messages: request.messages.map(toWireMessage),
    ...(request.tools.length
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters
            }
          }))
        }
      : {}),
    ...(request.thinking
      ? {
          thinking: { type: "enabled" },
          reasoning_effort: request.reasoningEffort
        }
      : { thinking: { type: "disabled" } }),
    ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
    ...(stream
      ? { stream: true, stream_options: { include_usage: true } }
      : { stream: false })
  };
}

export class OpenAIChatAdapter implements ProviderAdapter {
  readonly protocol = "openai-chat" as const;
  readonly capabilities = PROTOCOL_CAPABILITIES["openai-chat"];

  async complete(
    config: ProviderConfig,
    apiKey: string,
    request: ModelRequest
  ): Promise<ModelResponse> {
    assertDeepSeekWireModel(config.model);
    if (!request.stream) {
      const response = await postJson(
        joinUrl(config.baseUrl, "chat/completions"),
        apiKey,
        buildBody(config, request, false),
        config.headers,
        request.signal,
        config.timeoutMs
      );
      return parseChatResponse(
        (await response.json()) as Record<string, any>,
        response.headers.get("x-request-id")
      );
    }

    const state = {
      content: "",
      reasoningContent: "",
      usage: {} as Usage,
      finishReason: undefined as string | undefined,
      providerRequestId: undefined as string | undefined,
      providerModel: undefined as string | undefined,
      toolCalls: new Map<
        number,
        { id: string; name: string; arguments: string }
      >()
    };
    const streamResult = await postSse(
      joinUrl(config.baseUrl, "chat/completions"),
      apiKey,
      buildBody(config, request, true),
      (event) => {
        state.providerRequestId ??=
          typeof event.id === "string" ? event.id : undefined;
        if (typeof event.model === "string") {
          assertDeepSeekResponseModel(event.model);
          state.providerModel ??= event.model;
        }
        if (event.usage) state.usage = normalizeUsage(event.usage);
        const choice = Array.isArray(event.choices) ? event.choices[0] : undefined;
        if (!choice) return;
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string") state.content += delta.content;
        if (typeof delta.reasoning_content === "string") {
          state.reasoningContent += delta.reasoning_content;
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls) {
            const index = typeof call.index === "number" ? call.index : 0;
            const current = state.toolCalls.get(index) ?? {
              id: "",
              name: "",
              arguments: ""
            };
            if (typeof call.id === "string") current.id = call.id;
            if (typeof call.function?.name === "string") {
              current.name = call.function.name;
            }
            if (typeof call.function?.arguments === "string") {
              current.arguments += call.function.arguments;
            }
            state.toolCalls.set(index, current);
          }
        }
        if (typeof choice.finish_reason === "string") {
          state.finishReason = choice.finish_reason;
        }
      },
      config.headers,
      request.signal,
      config.timeoutMs
    );
    state.providerRequestId ??= streamResult.requestId;
    return {
      content: state.content,
      ...(state.reasoningContent
        ? { reasoningContent: state.reasoningContent }
        : {}),
      toolCalls: [...state.toolCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([index, call]) => ({
          id: call.id || `call-${index}`,
          name: call.name,
          arguments: parseArguments(call.arguments)
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

function parseChatResponse(
  body: Record<string, any>,
  responseRequestId?: string | null
): ModelResponse {
  assertDeepSeekResponseModel(body.model);
  const choice = body.choices?.[0] ?? {};
  const message = choice.message ?? {};
  return {
    content: typeof message.content === "string" ? message.content : "",
    ...(typeof message.reasoning_content === "string"
      ? { reasoningContent: message.reasoning_content }
      : {}),
    toolCalls: Array.isArray(message.tool_calls)
      ? message.tool_calls.map((call: any) => ({
          id: String(call.id),
          name: String(call.function?.name),
          arguments: parseArguments(call.function?.arguments)
        }))
      : [],
    usage: normalizeUsage(body.usage),
    finishReason: choice.finish_reason,
    providerRequestId: responseRequestId ?? body.id,
    providerModel: body.model
  };
}

function normalizeUsage(value: any): Usage {
  const usage = value && typeof value === "object" ? value : {};
  const cacheHit =
    usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  const cacheMiss =
    usage.prompt_cache_miss_tokens ??
    (usage.prompt_tokens !== undefined && cacheHit !== undefined
      ? Math.max(0, usage.prompt_tokens - cacheHit)
      : undefined);
  return {
    ...(usage.prompt_tokens !== undefined
      ? { inputTokens: usage.prompt_tokens }
      : {}),
    ...(usage.completion_tokens !== undefined
      ? { outputTokens: usage.completion_tokens }
      : {}),
    ...(cacheHit !== undefined ? { cacheHitTokens: cacheHit } : {}),
    ...(cacheMiss !== undefined ? { cacheMissTokens: cacheMiss } : {}),
    ...(usage.completion_tokens_details?.reasoning_tokens !== undefined
      ? { reasoningTokens: usage.completion_tokens_details.reasoning_tokens }
      : {})
  };
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
