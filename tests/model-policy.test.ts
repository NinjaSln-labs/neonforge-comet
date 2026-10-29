import test from "node:test";
import assert from "node:assert/strict";
import {
  DeepSeekModelPolicyError,
  buildStableSystemPrefix,
  chooseThinkingEffort,
  resolveDeepSeekModel
} from "../packages/deepseek/src/index.ts";
import { TOOL_DEFINITIONS } from "../packages/core/src/tools.ts";
import {
  AnthropicMessagesAdapter,
  OpenAIChatAdapter,
  OpenAIResponsesAdapter
} from "../packages/protocols/src/index.ts";
import { MockProvider } from "./helpers/mock-provider.ts";

const policyConfig = (
  baseUrl: string,
  protocol: "openai-chat" | "openai-responses" | "anthropic-messages"
) => ({
  id: "test",
  name: "test",
  baseUrl,
  protocol,
  model: "deepseek-flash"
});

const policyRequest = (stream: boolean) => ({
  messages: [{ role: "user" as const, content: "hi" }],
  tools: [],
  thinking: true,
  reasoningEffort: "high" as const,
  stream
});

const adapters = [
  { protocol: "openai-chat" as const, adapter: new OpenAIChatAdapter() },
  { protocol: "openai-responses" as const, adapter: new OpenAIResponsesAdapter() },
  { protocol: "anthropic-messages" as const, adapter: new AnthropicMessagesAdapter() }
];

test("resolves canonical model and compatibility aliases", () => {
  assert.equal(resolveDeepSeekModel("deepseek-flash").canonical.id, "deepseek-flash");
  assert.equal(resolveDeepSeekModel("deepseek-v4-pro").canonical.id, "deepseek-flash");
  assert.equal(
    resolveDeepSeekModel("commandcode-plan/deepseek/deepseek-v4.1-flash").canonical.id,
    "deepseek-flash"
  );
  assert.equal(
    resolveDeepSeekModel("vendor/DeepSeek-V4.1-Flash").canonical.id,
    "deepseek-flash"
  );
  assert.equal(resolveDeepSeekModel("auto").canonical.id, "deepseek-flash");
});

test("rejects non-DeepSeek model names", () => {
  assert.throws(
    () => resolveDeepSeekModel("gpt-4.1"),
    (error: unknown) => error instanceof DeepSeekModelPolicyError
  );
});

test("rejects a streamed provider response from a non-DeepSeek model", async () => {
  for (const { protocol, adapter } of adapters) {
    const mock = new MockProvider();
    const baseUrl = await mock.start();
    try {
      mock.enqueueSse(
        protocol === "openai-chat"
          ? [{ id: "chat-1", model: "gpt-4.1", choices: [{ delta: { content: "no" } }] }]
          : protocol === "openai-responses"
            ? [{ type: "response.created", response: { id: "resp-1", model: "gpt-4.1" } }]
            : [{ type: "message_start", message: { id: "msg-1", model: "gpt-4.1" } }]
      );
      await assert.rejects(
        adapter.complete(policyConfig(baseUrl, protocol), "test-key", policyRequest(true)),
        (error: unknown) =>
          error instanceof DeepSeekModelPolicyError && /gpt-4\.1/.test(error.message),
        `${protocol} accepted a streamed non-DeepSeek response model`
      );
    } finally {
      await mock.stop();
    }
  }
});

test("rejects a buffered provider response from a non-DeepSeek model", async () => {
  for (const { protocol, adapter } of adapters) {
    const mock = new MockProvider();
    const baseUrl = await mock.start();
    try {
      mock.enqueue(
        protocol === "openai-chat"
          ? {
              id: "chat-1",
              model: "gpt-4.1",
              choices: [{ message: { content: "no" }, finish_reason: "stop" }],
              usage: {}
            }
          : protocol === "openai-responses"
            ? {
                id: "resp-1",
                model: "gpt-4.1",
                status: "completed",
                output: [
                  { type: "message", content: [{ type: "output_text", text: "no" }] }
                ],
                usage: {}
              }
            : {
                id: "msg-1",
                model: "gpt-4.1",
                content: [{ type: "text", text: "no" }],
                stop_reason: "end_turn",
                usage: {}
              }
      );
      await assert.rejects(
        adapter.complete(policyConfig(baseUrl, protocol), "test-key", policyRequest(false)),
        (error: unknown) =>
          error instanceof DeepSeekModelPolicyError && /gpt-4\.1/.test(error.message),
        `${protocol} accepted a buffered non-DeepSeek response model`
      );
    } finally {
      await mock.stop();
    }
  }
});

test("accepts a vendor-prefixed DeepSeek response model", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  try {
    mock.enqueueSse([
      {
        id: "chat-1",
        model: "vendor/deepseek/deepseek-v4.1-flash",
        choices: [{ delta: { content: "ok" } }]
      }
    ]);
    const result = await new OpenAIChatAdapter().complete(
      policyConfig(baseUrl, "openai-chat"),
      "test-key",
      policyRequest(true)
    );
    assert.equal(result.content, "ok");
    assert.equal(result.providerModel, "vendor/deepseek/deepseek-v4.1-flash");
  } finally {
    await mock.stop();
  }
});

test("stable prompt prefix ignores tool ordering", () => {
  const a = buildStableSystemPrefix(TOOL_DEFINITIONS);
  const b = buildStableSystemPrefix([...TOOL_DEFINITIONS].reverse());
  assert.equal(a, b);
});

test("adaptive thinking is low for simple tasks and high for complex tasks", () => {
  assert.equal(chooseThinkingEffort("Reply with OK"), "low");
  assert.equal(chooseThinkingEffort("Analyze and refactor the architecture"), "high");
  assert.equal(chooseThinkingEffort("Reply with OK", "max"), "max");
});
