import type { CanonicalModel, CapabilityName } from "../../shared/src/types.ts";

export class DeepSeekModelPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekModelPolicyError";
  }
}

export const DEEPSEEK_MODELS: readonly CanonicalModel[] = [
  {
    id: "deepseek-flash",
    family: "deepseek",
    version: "DeepSeek-V4.1-Flash-1017",
    aliases: [
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4-pro"
    ],
    capabilities: {
      thinking: true,
      tools: true,
      vision: true,
      json: true,
      contextTokens: 1_000_000,
      maxOutputTokens: 384_000
    }
  }
] as const;

export const DEFAULT_CANONICAL_MODEL = "deepseek-flash";

export interface ModelSelection {
  canonical: CanonicalModel;
  requested: string;
  reason: string;
}

export function resolveDeepSeekModel(requested: string | undefined): ModelSelection {
  const value = requested?.trim() || "auto";
  if (value === "auto") {
    return {
      canonical: requireModel(DEFAULT_CANONICAL_MODEL),
      requested: value,
      reason: `auto selected the active baseline ${DEFAULT_CANONICAL_MODEL}`
    };
  }

  const model = DEEPSEEK_MODELS.find(
    (candidate) => candidate.id === value || candidate.aliases.includes(value)
  );
  if (model) {
    return {
      canonical: model,
      requested: value,
      reason: value === model.id ? "explicit canonical model" : `alias ${value} -> ${model.id}`
    };
  }

  if (isDeepSeekModelName(value)) {
    return {
      canonical: requireModel(DEFAULT_CANONICAL_MODEL),
      requested: value,
      reason: `provider model ${value} recognized as DeepSeek family; capabilities use ${DEFAULT_CANONICAL_MODEL}`
    };
  }

  throw new DeepSeekModelPolicyError(
    `Model "${value}" is not recognized as a DeepSeek-family model.`
  );
}

export function isDeepSeekModelName(value: string): boolean {
  const segments = value
    .trim()
    .toLowerCase()
    .split(/[/:@\s]+/)
    .filter(Boolean);
  return segments.some(
    (segment) =>
      segment === "deepseek" ||
      segment === "deepseek-ai" ||
      /^deepseek(?:[-_.]|$)/.test(segment)
  );
}

export function requireModel(id: string): CanonicalModel {
  const model = DEEPSEEK_MODELS.find((candidate) => candidate.id === id);
  if (!model) {
    throw new DeepSeekModelPolicyError(`Canonical model "${id}" is not registered.`);
  }
  return model;
}

export function listModels(): CanonicalModel[] {
  return DEEPSEEK_MODELS.map((model) => ({
    ...model,
    aliases: [...model.aliases],
    capabilities: { ...model.capabilities }
  }));
}

export function requiredCapabilitiesForObjective(
  objective: string
): CapabilityName[] {
  if (
    /\b(?:image|images|screenshot|photo|vision)\b|图片|截图|图像|看图/i.test(
      objective
    )
  ) {
    return ["vision"];
  }
  return [];
}
