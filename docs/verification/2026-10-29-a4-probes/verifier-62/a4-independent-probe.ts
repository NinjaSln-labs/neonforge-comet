import assert from "node:assert/strict";

const root =
  "file:///workspace/neonforge-comet";

const { MockProvider } = await import(
  `${root}/tests/helpers/mock-provider.ts`
);
const { DeepSeekModelPolicyError } = await import(
  `${root}/packages/deepseek/src/index.ts`
);
const {
  AnthropicMessagesAdapter,
  OpenAIChatAdapter,
  OpenAIResponsesAdapter
} = await import(`${root}/packages/protocols/src/index.ts`);

type Protocol = "openai-chat" | "openai-responses" | "anthropic-messages";

const adapters = [
  ["openai-chat", new OpenAIChatAdapter()],
  ["openai-responses", new OpenAIResponsesAdapter()],
  ["anthropic-messages", new AnthropicMessagesAdapter()]
] as const;

const request = (stream: boolean) => ({
  messages: [{ role: "user" as const, content: "Return ok" }],
  tools: [],
  thinking: true,
  reasoningEffort: "high" as const,
  stream
});

function bufferedBody(protocol: Protocol, model: string) {
  if (protocol === "openai-chat") {
    return {
      id: "chat-1",
      model,
      choices: [
        {
          message: { content: "ok", reasoning_content: "reasoning" },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    };
  }
  if (protocol === "openai-responses") {
    return {
      id: "resp-1",
      model,
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "ok" }]
        }
      ],
      usage: { input_tokens: 1, output_tokens: 1 }
    };
  }
  return {
    id: "msg-1",
    model,
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 }
  };
}

function streamEvents(protocol: Protocol, model: string) {
  if (protocol === "openai-chat") {
    return [
      {
        id: "chat-1",
        model,
        choices: [{ delta: { content: "ok" }, finish_reason: "stop" }]
      }
    ];
  }
  if (protocol === "openai-responses") {
    return [
      { type: "response.created", response: { id: "resp-1", model } },
      { type: "response.output_text.delta", delta: "ok" },
      {
        type: "response.completed",
        response: bufferedBody(protocol, model)
      }
    ];
  }
  return [
    {
      type: "message_start",
      message: {
        id: "msg-1",
        model,
        usage: { input_tokens: 1 }
      }
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" }
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "ok" }
    },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 1 }
    }
  ];
}

const observations: Array<Record<string, unknown>> = [];
for (const [protocol, adapter] of adapters) {
  for (const stream of [false, true]) {
    const mock = new MockProvider();
    const baseUrl = await mock.start();
    try {
      if (stream) {
        mock.enqueueSse(streamEvents(protocol, "gpt-4.1"));
      } else {
        mock.enqueue(bufferedBody(protocol, "gpt-4.1"));
      }
      let error: unknown;
      try {
        await adapter.complete(
          {
            id: "mock",
            name: "mock",
            baseUrl,
            protocol,
            model: "deepseek-flash"
          },
          "test-key",
          request(stream)
        );
      } catch (caught) {
        error = caught;
      }
      assert.ok(
        error instanceof DeepSeekModelPolicyError,
        `${protocol} ${stream ? "streaming" : "buffered"} did not reject with DeepSeekModelPolicyError`
      );
      assert.match(String((error as Error).message), /gpt-4\.1/);
      observations.push({
        case: `${protocol}-${stream ? "streaming" : "buffered"}-non-deepseek`,
        requestModel: "deepseek-flash",
        responseModel: "gpt-4.1",
        outcome: "rejected",
        errorName: (error as Error).name,
        errorMessage: (error as Error).message
      });
    } finally {
      await mock.stop();
    }
  }

  for (const stream of [false, true]) {
    const vendorModel = "vendor/deepseek/deepseek-v4.1-flash";
    const mock = new MockProvider();
    const baseUrl = await mock.start();
    try {
      if (stream) {
        mock.enqueueSse(streamEvents(protocol, vendorModel));
      } else {
        mock.enqueue(bufferedBody(protocol, vendorModel));
      }
      const result = await adapter.complete(
        {
          id: "mock",
          name: "mock",
          baseUrl,
          protocol,
          model: "deepseek-flash"
        },
        "test-key",
        request(stream)
      );
      assert.equal(result.content, "ok");
      assert.equal(result.providerModel, vendorModel);
      observations.push({
        case: `${protocol}-${stream ? "streaming" : "buffered"}-vendor-deepseek`,
        requestModel: "deepseek-flash",
        responseModel: vendorModel,
        outcome: "accepted",
        providerModel: result.providerModel
      });
    } finally {
      await mock.stop();
    }
  }
}

console.log(JSON.stringify({ observations }, null, 2));
