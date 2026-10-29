import type {
  CanonicalModel,
  CapabilityName,
  ProtocolCapabilities,
  ProviderConfig
} from "../../shared/src/types.ts";

const COMMON_CAPABILITIES: ProtocolCapabilities = {
  thinking: true,
  tools: true,
  vision: false,
  json: true,
  streaming: true,
  maxOutputTokens: 384_000
};

export const PROTOCOL_CAPABILITIES: Record<
  ProviderConfig["protocol"],
  ProtocolCapabilities
> = {
  "openai-chat": { ...COMMON_CAPABILITIES },
  "openai-responses": { ...COMMON_CAPABILITIES },
  "anthropic-messages": { ...COMMON_CAPABILITIES }
};

export class UnsupportedCapabilityError extends Error {
  readonly capability: CapabilityName;
  readonly protocol: ProviderConfig["protocol"];

  constructor(
    capability: CapabilityName,
    protocol: ProviderConfig["protocol"],
    detail: string
  ) {
    super(`Unsupported capability "${capability}" for ${protocol}: ${detail}`);
    this.name = "UnsupportedCapabilityError";
    this.capability = capability;
    this.protocol = protocol;
  }
}

export function validateModelCapabilities(
  model: CanonicalModel,
  protocol: ProviderConfig["protocol"],
  required: readonly CapabilityName[] = []
): void {
  const protocolCapabilities = PROTOCOL_CAPABILITIES[protocol];
  for (const capability of required) {
    if (!model.capabilities[capability]) {
      throw new UnsupportedCapabilityError(
        capability,
        protocol,
        `canonical model ${model.id} does not advertise it`
      );
    }
    if (!protocolCapabilities[capability]) {
      throw new UnsupportedCapabilityError(
        capability,
        protocol,
        "the selected protocol adapter cannot express it"
      );
    }
  }
  if (!protocolCapabilities.streaming) {
    throw new UnsupportedCapabilityError(
      "tools",
      protocol,
      "the adapter cannot provide the required normalized response"
    );
  }
}
