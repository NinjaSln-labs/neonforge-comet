export * from "./types.ts";
export * from "./capabilities.ts";
export * from "./model-guard.ts";
export * from "./openai-chat.ts";
export * from "./openai-responses.ts";
export * from "./anthropic.ts";

import { AnthropicMessagesAdapter } from "./anthropic.ts";
import { OpenAIChatAdapter } from "./openai-chat.ts";
import { OpenAIResponsesAdapter } from "./openai-responses.ts";
import type { ProviderAdapter } from "./types.ts";

export function createAdapter(protocol: string): ProviderAdapter {
  switch (protocol) {
    case "openai-chat":
      return new OpenAIChatAdapter();
    case "openai-responses":
      return new OpenAIResponsesAdapter();
    case "anthropic-messages":
      return new AnthropicMessagesAdapter();
    default:
      throw new Error(`Unsupported provider protocol: ${protocol}`);
  }
}
