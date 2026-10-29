import { ProviderError } from "./types.ts";
import { DeepSeekModelPolicyError } from "../../deepseek/src/model-registry.ts";

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function joinVersionedUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/v1") && path.startsWith("v1/")) {
    return `${base}/${path.slice(3)}`;
  }
  return joinUrl(base, path);
}

export async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
  timeoutMs = 120_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const relay = () => controller.abort();
  signal?.addEventListener("abort", relay, { once: true });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new ProviderError(
        `Provider request failed (${response.status}): ${redact(text).slice(0, 500)}`,
        response.status,
        response.headers.get("x-request-id") ?? undefined
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderError(`Provider request timed out after ${timeoutMs}ms`);
    }
    throw new ProviderError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

export async function postSse(
  url: string,
  apiKey: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
  timeoutMs = 120_000
): Promise<{ requestId?: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const relay = () => controller.abort();
  signal?.addEventListener("abort", relay, { once: true });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${apiKey}`,
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new ProviderError(
        `Provider request failed (${response.status}): ${redact(text).slice(0, 500)}`,
        response.status,
        response.headers.get("x-request-id") ?? undefined
      );
    }
    if (!response.body) {
      throw new ProviderError("Provider returned an empty streaming response.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (processSseBlock(block, onEvent)) {
          done = true;
          await reader.cancel();
          break;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode().replace(/\r\n/g, "\n");
    if (!done && buffer.trim()) processSseBlock(buffer, onEvent);
    const requestId = response.headers.get("x-request-id");
    return requestId ? { requestId } : {};
  } catch (error) {
    // A policy rejection raised while reading the stream is not a transport
    // failure; keep its type so callers can report it as a model-policy error.
    if (error instanceof ProviderError || error instanceof DeepSeekModelPolicyError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new ProviderError(
        timedOut
          ? `Provider request timed out after ${timeoutMs}ms`
          : "Provider request cancelled"
      );
    }
    throw new ProviderError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

function processSseBlock(
  block: string,
  onEvent: (event: Record<string, unknown>) => void
): boolean {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return false;
  if (data.trim() === "[DONE]") return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new ProviderError("Provider returned malformed SSE JSON.");
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    // Dispatch outside the parse guard so policy and consumer errors keep
    // their original type instead of being reported as malformed JSON.
    onEvent(parsed as Record<string, unknown>);
  }
  return false;
}

export function redact(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(
      /(["']?(?:api[_-]?key|authorization|token)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1***"
    );
}
