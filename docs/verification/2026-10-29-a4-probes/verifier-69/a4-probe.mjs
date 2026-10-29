import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const repo = "/workspace/neonforge-comet";
const { DeepSeekModelPolicyError } = await import(
  `${repo}/packages/deepseek/src/model-registry.ts`
);
const {
  OpenAIChatAdapter,
  OpenAIResponsesAdapter,
  AnthropicMessagesAdapter
} = await import(`${repo}/packages/protocols/src/index.ts`);

const adapters = [
  ["openai-chat", new OpenAIChatAdapter()],
  ["openai-responses", new OpenAIResponsesAdapter()],
  ["anthropic-messages", new AnthropicMessagesAdapter()]
];

let responseModel = "gpt-4.1";
const requests = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  const body = raw ? JSON.parse(raw) : {};
  requests.push({ url: req.url, body });

  if (!body.stream) {
    let response;
    if (req.url === "/chat/completions") {
      response = {
        id: "chat-buffered",
        model: responseModel,
        choices: [
          { message: { content: "accepted" }, finish_reason: "stop" }
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1 }
      };
    } else if (req.url === "/responses") {
      response = {
        id: "responses-buffered",
        model: responseModel,
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "accepted" }]
          }
        ],
        usage: { input_tokens: 3, output_tokens: 1 }
      };
    } else if (req.url === "/v1/messages") {
      response = {
        id: "anthropic-buffered",
        model: responseModel,
        content: [{ type: "text", text: "accepted" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 3, output_tokens: 1 }
      };
    } else {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
    return;
  }

  let events;
  if (req.url === "/chat/completions") {
    events = [
      {
        id: "chat-stream",
        model: responseModel,
        choices: [{ delta: { content: "accepted" }, finish_reason: "stop" }]
      }
    ];
  } else if (req.url === "/responses") {
    events = [
      {
        type: "response.created",
        response: { id: "responses-stream", model: responseModel }
      },
      { type: "response.output_text.delta", delta: "accepted" },
      {
        type: "response.completed",
        response: {
          id: "responses-stream",
          model: responseModel,
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "accepted" }]
            }
          ],
          usage: { input_tokens: 3, output_tokens: 1 }
        }
      }
    ];
  } else if (req.url === "/v1/messages") {
    events = [
      {
        type: "message_start",
        message: {
          id: "anthropic-stream",
          model: responseModel,
          usage: { input_tokens: 3 }
        }
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "accepted" }
      },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 1 }
      },
      { type: "message_stop" }
    ];
  } else {
    res.writeHead(404).end();
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache"
  });
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end("data: [DONE]\n\n");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const config = (protocol) => ({
  id: "independent-a4",
  name: "Independent A4 probe",
  baseUrl,
  protocol,
  model: "deepseek-flash"
});
const request = (stream) => ({
  messages: [{ role: "user", content: "return one word" }],
  tools: [],
  thinking: true,
  reasoningEffort: "high",
  stream
});

const outcomes = [];
try {
  for (const [protocol, adapter] of adapters) {
    for (const stream of [false, true]) {
      responseModel = "gpt-4.1";
      await assert.rejects(
        adapter.complete(config(protocol), "independent-test-key", request(stream)),
        (error) =>
          error instanceof DeepSeekModelPolicyError &&
          /gpt-4\.1/.test(error.message),
        `${protocol} stream=${stream} did not reject gpt-4.1`
      );
      outcomes.push({
        protocol,
        mode: stream ? "streaming" : "buffered",
        responseModel,
        result: "rejected-DeepSeekModelPolicyError"
      });

      responseModel = "vendor/deepseek/deepseek-v4.1-flash";
      const accepted = await adapter.complete(
        config(protocol),
        "independent-test-key",
        request(stream)
      );
      assert.equal(accepted.providerModel, responseModel);
      assert.equal(accepted.content, "accepted");
      outcomes.push({
        protocol,
        mode: stream ? "streaming" : "buffered",
        responseModel,
        result: "accepted"
      });
    }
  }

  assert.ok(requests.some((entry) => entry.body.model === "deepseek-flash"));
  assert.ok(requests.every((entry) => entry.body.model === "deepseek-flash"));

  for (const [protocol, adapter] of adapters) {
    for (const stream of [false, true]) {
      const requestsBefore = requests.length;
      await assert.rejects(
        adapter.complete(
          { ...config(protocol), model: "gpt-4.1" },
          "independent-test-key",
          request(stream)
        ),
        (error) =>
          error instanceof DeepSeekModelPolicyError &&
          /gpt-4\.1/.test(error.message),
        `${protocol} stream=${stream} did not reject an outbound gpt-4.1 request`
      );
      assert.equal(
        requests.length,
        requestsBefore,
        `${protocol} stream=${stream} dispatched a rejected outbound model`
      );
      outcomes.push({
        protocol,
        mode: stream ? "streaming" : "buffered",
        requestedModel: "gpt-4.1",
        result: "rejected-before-dispatch"
      });
    }
  }

  responseModel = "gpt-4.1";
  const cliHome = mkdtempSync(join(tmpdir(), "neonforge-a4-home-"));
  const cliWorkspace = mkdtempSync(join(tmpdir(), "neonforge-a4-workspace-"));
  mkdirSync(join(cliHome, "sessions"), { recursive: true });
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      `${repo}/apps/cli/src/main.ts`,
      "run",
      "return one word",
      "--workspace",
      cliWorkspace,
      "--json"
    ],
    {
      cwd: repo,
      env: {
        ...process.env,
        NEONFORGE_HOME: cliHome,
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_KEY: "independent-test-key",
        OPENAI_MODEL: "deepseek-flash",
        NEONFORGE_PROTOCOL: "openai-chat"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(exitCode, 4);
  assert.match(stderr, /model policy error: .*gpt-4\.1/);
  outcomes.push({
    protocol: "openai-chat",
    mode: "cli-buffered",
    responseModel,
    result: "cli-exit-4-model-policy-error",
    exitCode,
    stderr: stderr.trim()
  });

  console.log(
    JSON.stringify(
      {
        probe: "independent A4 response-model policy",
        outcomes,
        responseModelCaseCount: 12,
        outboundModelCaseCount: 6,
        requestCount: requests.length,
        cliStdoutLines: stdout.trim() ? stdout.trim().split("\n").length : 0
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
