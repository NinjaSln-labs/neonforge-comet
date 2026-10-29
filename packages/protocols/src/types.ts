import type {
  ConversationMessage,
  ModelResponse,
  ProtocolCapabilities,
  ProviderConfig,
  ThinkingEffort,
  ToolDefinition
} from "../../shared/src/types.ts";

export interface ModelRequest {
  messages: ConversationMessage[];
  tools: ToolDefinition[];
  thinking: boolean;
  reasoningEffort: ThinkingEffort;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  stream?: boolean;
  seed?: number;
}

export interface ProviderAdapter {
  readonly protocol: ProviderConfig["protocol"];
  readonly capabilities: ProtocolCapabilities;
  complete(
    config: ProviderConfig,
    apiKey: string,
    request: ModelRequest
  ): Promise<ModelResponse>;
}

export class ProviderError extends Error {
  readonly status?: number;
  readonly requestId?: string;

  constructor(message: string, status?: number, requestId?: string) {
    super(message);
    this.name = "ProviderError";
    if (status !== undefined) this.status = status;
    if (requestId !== undefined) this.requestId = requestId;
  }
}
