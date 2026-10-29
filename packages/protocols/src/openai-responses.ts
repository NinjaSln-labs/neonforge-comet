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

function buildBody(
  config: ProviderConfig,
  request: ModelRequest,
  stream: boolean
): Record<string, unknown> {
  return {
    model: config.model,
    input: toResponsesInput(request.messages),
    ...(request.tools.length
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }))
        }
      : {}),
    ...(request.thinking
      ? { reasoning: { effort: request.reasoningEffort } }
      : {}),
    ...(request.maxOutputTokens
      ? { max_output_tokens: request.maxOutputTokens }
      : {}),
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
    stream
  };
}

function toResponsesInput(
  messages: ModelRequest["messages"]
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content
      });
      continue;
    }
    if (message.role === "assistant") {
      if (message.content || message.reasoningContent) {
        input.push({
          role: "assistant",
          content: message.content,
          ...(message.reasoningContent
            ? { reasoning_content: message.reasoningContent }
            : {})
        });
      }
      for (const call of message.toolCalls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments)
        });
      }
      continue;
    }
    input.push({ role: message.role, content: message.content });
  }
  return input;
}

export class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly protocol = "openai-responses" as const;
  readonly capabilities = PROTOCOL_CAPABILITIES["openai-responses"];

  async complete(
    config: ProviderConfig,
    apiKey: string,
    request: ModelRequest
  ): Promise<ModelResponse> {
    assertDeepSeekWireModel(config.model);
    if (!request.stream) {
      const response = await postJson(
        joinUrl(config.baseUrl, "responses"),
        apiKey,
        buildBody(config, request, false),
        config.headers,
        request.signal,
        config.timeoutMs
      );
      return parseResponse(
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
        string,
        { index: number; id: string; name: string; arguments: string }
      >()
    };
    const completeResponse = (body: Record<string, any>) => {
      const parsed = parseResponse(body, state.providerRequestId);
      if (parsed.content) state.content = parsed.content;
      if (parsed.reasoningContent) {
        state.reasoningContent = parsed.reasoningContent;
      }
      if (parsed.usage) state.usage = parsed.usage;
      if (parsed.finishReason) state.finishReason = parsed.finishReason;
      if (parsed.providerModel) state.providerModel = parsed.providerModel;
      if (parsed.toolCalls.length) {
        state.toolCalls.clear();
        parsed.toolCalls.forEach((call, index) => {
          state.toolCalls.set(call.id, {
            index,
            id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.arguments)
          });
        });
      }
    };
    const streamResult = await postSse(
      joinUrl(config.baseUrl, "responses"),
      apiKey,
      buildBody(config, request, true),
      (event) => {
        const type = String(event.type ?? "");
        const response = event.response as Record<string, any> | undefined;
        if (response?.id) state.providerRequestId ??= String(response.id);
        if (response?.model) {
          assertDeepSeekResponseModel(response.model);
          state.providerModel ??= String(response.model);
        }
        if (response?.usage) state.usage = normalizeUsage(response.usage);
        if (response?.status) state.finishReason ??= String(response.status);

        if (type === "response.output_text.delta" && typeof event.delta === "string") {
          state.content += event.delta;
          return;
        }
        if (
          (type === "response.reasoning_summary_text.delta" ||
            type === "response.reasoning_text.delta") &&
          typeof event.delta === "string"
        ) {
          state.reasoningContent += event.delta;
          return;
        }
        if (type === "response.output_item.added") {
          const item = event.item as Record<string, any> | undefined;
          if (item?.type === "function_call") {
            const key = String(item.id ?? item.call_id ?? event.output_index ?? 0);
            state.toolCalls.set(key, {
              index: Number(event.output_index ?? 0),
              id: String(item.call_id ?? item.id ?? key),
              name: String(item.name ?? ""),
              arguments: String(item.arguments ?? "")
            });
          }
          return;
        }
        if (
          type === "response.function_call_arguments.delta" &&
          typeof event.delta === "string"
        ) {
          const key = String(event.item_id ?? event.output_index ?? 0);
          const current = state.toolCalls.get(key);
          if (current) state.toolCalls.set(key, {
            ...current,
            arguments: current.arguments + event.delta
          });
          return;
        }
        if (type === "response.output_item.done") {
          const item = event.item as Record<string, any> | undefined;
          if (item?.type === "function_call") {
            const key = String(item.id ?? item.call_id ?? event.output_index ?? 0);
            state.toolCalls.set(key, {
              index: Number(event.output_index ?? 0),
              id: String(item.call_id ?? item.id ?? key),
              name: String(item.name ?? ""),
              arguments: String(item.arguments ?? "")
            });
          }
          return;
        }
        if (type === "response.completed" && response) {
          completeResponse(response);
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
      toolCalls: [...state.toolCalls.values()]
        .sort((left, right) => left.index - right.index)
        .map((call) => ({
          id: call.id,
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

function parseResponse(
  body: Record<string, any>,
  responseRequestId?: string | null
): ModelResponse {
  assertDeepSeekResponseModel(body.model);
  const output = Array.isArray(body.output) ? body.output : [];
  const textParts: string[] = [];
  const toolCalls: ModelResponse["toolCalls"] = [];
  for (const item of output) {
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
    }
    if (item.type === "function_call") {
      toolCalls.push({
        id: String(item.call_id ?? item.id),
        name: String(item.name),
        arguments: parseArguments(item.arguments)
      });
    }
  }
  return {
    content: textParts.join(""),
    ...(typeof body.reasoning_content === "string"
      ? { reasoningContent: body.reasoning_content }
      : {}),
    toolCalls,
    usage: normalizeUsage(body.usage),
    finishReason: body.status,
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
    ...(usage.input_tokens_details?.cached_tokens !== undefined
      ? { cacheHitTokens: usage.input_tokens_details.cached_tokens }
      : {}),
    ...(usage.output_tokens_details?.reasoning_tokens !== undefined
      ? { reasoningTokens: usage.output_tokens_details.reasoning_tokens }
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
