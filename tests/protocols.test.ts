import test from "node:test";
import assert from "node:assert/strict";
import {
  AnthropicMessagesAdapter,
  OpenAIChatAdapter,
  OpenAIResponsesAdapter
} from "../packages/protocols/src/index.ts";
import { MockProvider } from "./helpers/mock-provider.ts";

test("OpenAI Chat adapter normalizes content, reasoning, tools, and usage", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  mock.enqueue({
    id: "chat-1",
    model: "deepseek-flash",
    choices: [
      {
        message: {
          content: "hello",
          reasoning_content: "reason",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" }
            }
          ]
        },
        finish_reason: "tool_calls"
      }
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20
    }
  });
  try {
    const adapter = new OpenAIChatAdapter();
    const result = await adapter.complete(
      { id: "test", name: "test", baseUrl, protocol: "openai-chat", model: "deepseek-flash" },
      "test-key",
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        thinking: true,
        reasoningEffort: "high"
      }
    );
    assert.equal(result.content, "hello");
    assert.equal(result.reasoningContent, "reason");
    assert.equal(result.toolCalls[0]?.name, "read_file");
    assert.equal(result.usage.cacheHitTokens, 80);
    assert.equal(mock.requests[0]?.url, "/chat/completions");
  } finally {
    await mock.stop();
  }
});

test("OpenAI Responses adapter normalizes output", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  mock.enqueue({
    id: "resp-1",
    model: "deepseek-flash",
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "response text" }]
      }
    ],
    usage: { input_tokens: 30, output_tokens: 5 }
  });
  try {
    const adapter = new OpenAIResponsesAdapter();
    const result = await adapter.complete(
      { id: "test", name: "test", baseUrl, protocol: "openai-responses", model: "deepseek-flash" },
      "test-key",
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        thinking: false,
        reasoningEffort: "low"
      }
    );
    assert.equal(result.content, "response text");
    assert.equal(result.usage.inputTokens, 30);
    assert.equal(mock.requests[0]?.url, "/responses");
  } finally {
    await mock.stop();
  }
});

test("Anthropic adapter normalizes thinking, text, tool use, and usage", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  mock.enqueue({
    id: "msg-1",
    model: "deepseek-flash",
    content: [
      { type: "thinking", thinking: "plan" },
      { type: "text", text: "answer" },
      { type: "tool_use", id: "tool-1", name: "read_file", input: { path: "a.txt" } }
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 12, output_tokens: 4 }
  });
  try {
    const adapter = new AnthropicMessagesAdapter();
    const result = await adapter.complete(
      {
        id: "test",
        name: "test",
        baseUrl,
        protocol: "anthropic-messages",
        model: "deepseek-flash"
      },
      "test-key",
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        thinking: true,
        reasoningEffort: "high"
      }
    );
    assert.equal(result.content, "answer");
    assert.equal(result.reasoningContent, "plan");
    assert.equal(result.toolCalls[0]?.id, "tool-1");
    assert.equal(mock.requests[0]?.url, "/v1/messages");
  } finally {
    await mock.stop();
  }
});

test("OpenAI Responses adapter emits native function-call input items", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  mock.enqueue({
    id: "resp-tool",
    model: "deepseek-flash",
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "done" }]
      }
    ],
    usage: { input_tokens: 10, output_tokens: 2 }
  });
  try {
    const adapter = new OpenAIResponsesAdapter();
    await adapter.complete(
      {
        id: "test",
        name: "test",
        baseUrl,
        protocol: "openai-responses",
        model: "deepseek-flash"
      },
      "test-key",
      {
        messages: [
          { role: "user", content: "inspect" },
          {
            role: "assistant",
            content: "",
            reasoningContent: "plan",
            toolCalls: [
              {
                id: "call-1",
                name: "read_file",
                arguments: { path: "README.md" }
              }
            ]
          },
          {
            role: "tool",
            toolCallId: "call-1",
            content: "workspace contents"
          }
        ],
        tools: [],
        thinking: true,
        reasoningEffort: "high"
      }
    );
    const input = mock.requests[0]?.body.input as Array<Record<string, unknown>>;
    const functionCall = input.find((item) => item.type === "function_call");
    const functionOutput = input.find(
      (item) => item.type === "function_call_output"
    );
    assert.equal(functionCall?.call_id, "call-1");
    assert.equal(functionCall?.name, "read_file");
    assert.deepEqual(JSON.parse(String(functionCall?.arguments)), {
      path: "README.md"
    });
    assert.equal(functionOutput?.call_id, "call-1");
    assert.equal(functionOutput?.output, "workspace contents");
    assert.equal(input.some((item) => item.role === "tool"), false);
  } finally {
    await mock.stop();
  }
});
