import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

export class MockProvider {
  readonly requests: CapturedRequest[] = [];
  private readonly responses: Array<
    | {
        kind: "json";
        status: number;
        body: Record<string, unknown>;
      }
    | {
        kind: "sse";
        status: number;
        events: Array<Record<string, unknown>>;
        delayMs: number;
        holdMs: number;
      }
  > = [];
  private server = createServer((request, response) => {
    void this.handle(request, response);
  });

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  enqueue(body: Record<string, unknown>, status = 200): void {
    this.responses.push({ kind: "json", status, body });
  }

  enqueueSse(
    events: Array<Record<string, unknown>>,
    options: { status?: number; delayMs?: number; holdMs?: number } = {}
  ): void {
    this.responses.push({
      kind: "sse",
      status: options.status ?? 200,
      events,
      delayMs: options.delayMs ?? 0,
      holdMs: options.holdMs ?? 0
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve()))
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      body = { raw };
    }
    this.requests.push({
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      body
    });
    const next = this.responses.shift() ?? {
      kind: "json" as const,
      status: 200,
      body: {
        id: "mock",
        model: "deepseek-flash",
        choices: [
          {
            message: { content: "OK", reasoning_content: "mock reasoning" },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2 }
      }
    };
    if (next.kind === "sse") {
      response.writeHead(next.status, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      if (next.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, next.delayMs));
      }
      for (const event of next.events) {
        if (response.destroyed) return;
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      if (next.holdMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, next.holdMs));
      }
      if (!response.destroyed) response.end("data: [DONE]\n\n");
      return;
    }
    response.writeHead(next.status, { "content-type": "application/json" });
    response.end(JSON.stringify(next.body));
  }
}
