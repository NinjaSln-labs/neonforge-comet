import test from "node:test";
import assert from "node:assert/strict";
import {
  AnthropicMessagesAdapter,
  OpenAIChatAdapter,
  OpenAIResponsesAdapter,
  ProviderError
} from "../packages/protocols/src/index.ts";
import { MockProvider } from "./helpers/mock-provider.ts";

const config = (baseUrl: string, protocol: "openai-chat" | "openai-responses" | "anthropic-messages") => ({
  id: "test",
  name: "test",
  baseUrl,
  protocol,
  model: "deepseek-flash"
});

test("OpenAI Chat streaming normalizes text, reasoning, tools, and usage", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  mock.enqueueSse([
    { id: "chat-stream", model: "deepseek-flash", choices: [{ delta: { content: "answer " } }] },
    { choices: [{ delta: { content: "text", reasoning_content: "plan" } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                function: { name: "read_file", arguments: "{\"path\":" }
              }
            ]
          }
        }
      ]
    },
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: "\"README.md\"}" } }]
          }
        }
      ]
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    {
      choices: [],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20
      }
    }
  ]);
  try {
    const result = await new OpenAIChatAdapter().complete(
      config(baseUrl, "openai-chat"),
      "test-key",
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        thinking: true,
        reasoningEffort: "high",
        stream: true
      }
    );
    assert.equal(result.content, "answer text");
    assert.equal(result.reasoningContent, "plan");
    assert.deepEqual(result.toolCalls[0]?.arguments, { path: "README.md" });
    assert.equal(result.usage.cacheHitTokens, 80);
    assert.equal(result.finishReason, "tool_calls");
    assert.equal(mock.requests[0]?.body.stream, true);
  } finally {
    await mock.stop();
  }
});

test("OpenAI Responses streaming normalizes output and function calls", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  mock.enqueueSse([
    {
      type: "response.created",
      response: { id: "resp-stream", model: "deepseek-flash" }
    },
    { type: "response.output_text.delta", delta: "hello " },
    { type: "response.reasoning_summary_text.delta", delta: "think" },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        id: "item-1",
        type: "function_call",
        call_id: "call-1",
        name: "read_file",
        arguments: ""
      }
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: "item-1",
      delta: "{\"path\":\"README.md\"}"
    },
    {
      type: "response.completed",
      response: {
        id: "resp-stream",
        model: "deepseek-flash",
        status: "completed",
        usage: {
          input_tokens: 20,
          output_tokens: 4,
          input_tokens_details: { cached_tokens: 10 }
        },
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "hello world" }]
          },
          {
            type: "function_call",
            id: "item-1",
            call_id: "call-1",
            name: "read_file",
            arguments: "{\"path\":\"README.md\"}"
          }
        ]
      }
    }
  ]);
  try {
    const result = await new OpenAIResponsesAdapter().complete(
      config(baseUrl, "openai-responses"),
      "test-key",
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        thinking: true,
        reasoningEffort: "high",
        stream: true
      }
    );
    assert.equal(result.content, "hello world");
    assert.equal(result.reasoningContent, "think");
    assert.equal(result.toolCalls[0]?.name, "read_file");
    assert.deepEqual(result.toolCalls[0]?.arguments, { path: "README.md" });
    assert.equal(result.usage.cacheHitTokens, 10);
    assert.equal(result.finishReason, "completed");
  } finally {
    await mock.stop();
  }
});

test("Anthropic streaming normalizes thinking, text, tools, and usage", async () => {
  const mock = new MockProvider();
  const baseUrl = await mock.start();
  mock.enqueueSse([
    {
      type: "message_start",
      message: {
        id: "msg-stream",
        model: "deepseek-flash",
        usage: { input_tokens: 20, cache_read_input_tokens: 10 }
      }
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking" }
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "plan" }
    },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "text" }
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "answer" }
    },
    {
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "tool-1", name: "read_file" }
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: "{\"path\":\"README.md\"}" }
    },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 4 }
    },
    { type: "message_stop" }
  ]);
  try {
    const result = await new AnthropicMessagesAdapter().complete(
      config(baseUrl, "anthropic-messages"),
      "test-key",
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        thinking: true,
        reasoningEffort: "high",
        stream: true
      }
    );
    assert.equal(result.content, "answer");
    assert.equal(result.reasoningContent, "plan");
    assert.equal(result.toolCalls[0]?.id, "tool-1");
    assert.deepEqual(result.toolCalls[0]?.arguments, { path: "README.md" });
    assert.equal(result.usage.cacheHitTokens, 10);
    assert.equal(result.usage.outputTokens, 4);
    assert.equal(result.finishReason, "tool_use");
  } finally {
    await mock.stop();
  }
});

test("all protocol adapters surface provider errors with status", async () => {
  for (const [adapter, protocol] of [
    [new OpenAIChatAdapter(), "openai-chat"],
    [new OpenAIResponsesAdapter(), "openai-responses"],
    [new AnthropicMessagesAdapter(), "anthropic-messages"]
  ] as const) {
    const mock = new MockProvider();
    const baseUrl = await mock.start();
    mock.enqueue({ error: "rate limited" }, 429);
    try {
      await assert.rejects(
        () =>
          adapter.complete(config(baseUrl, protocol), "test-key", {
            messages: [{ role: "user", content: "hi" }],
            tools: [],
            thinking: false,
            reasoningEffort: "low"
          }),
        (error: unknown) =>
          error instanceof ProviderError &&
          error.status === 429 &&
          /rate limited/.test(error.message)
      );
    } finally {
      await mock.stop();
    }
  }
});

test("all protocol adapters reject non-DeepSeek models before dispatch", async () => {
  for (const [adapter, protocol] of [
    [new OpenAIChatAdapter(), "openai-chat"],
    [new OpenAIResponsesAdapter(), "openai-responses"],
    [new AnthropicMessagesAdapter(), "anthropic-messages"]
  ] as const) {
    const mock = new MockProvider();
    const baseUrl = await mock.start();
    try {
      await assert.rejects(
        () =>
          adapter.complete(
            { ...config(baseUrl, protocol), model: "gpt-4.1" },
            "test-key",
            {
              messages: [{ role: "user", content: "hi" }],
              tools: [],
              thinking: false,
              reasoningEffort: "low"
            }
          ),
        /not recognized as a DeepSeek-family model/
      );
      assert.equal(mock.requests.length, 0);
    } finally {
      await mock.stop();
    }
  }
});

test("all streaming adapters honor cancellation", async () => {
  for (const [adapter, protocol, start] of [
    [
      new OpenAIChatAdapter(),
      "openai-chat",
      { choices: [{ delta: { content: "started" } }] }
    ],
    [
      new OpenAIResponsesAdapter(),
      "openai-responses",
      { type: "response.created", response: { id: "resp", model: "deepseek-flash" } }
    ],
    [
      new AnthropicMessagesAdapter(),
      "anthropic-messages",
      {
        type: "message_start",
        message: { id: "msg", model: "deepseek-flash", usage: { input_tokens: 1 } }
      }
    ]
  ] as const) {
    const mock = new MockProvider();
    const baseUrl = await mock.start();
    mock.enqueueSse([start], { holdMs: 500 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25);
    try {
      await assert.rejects(
        () =>
          adapter.complete(config(baseUrl, protocol), "test-key", {
            messages: [{ role: "user", content: "hi" }],
            tools: [],
            thinking: false,
            reasoningEffort: "low",
            stream: true,
            signal: controller.signal
          }),
        (error: unknown) =>
          error instanceof ProviderError && /cancelled/.test(error.message)
      );
    } finally {
      clearTimeout(timer);
      await mock.stop();
    }
  }
});
