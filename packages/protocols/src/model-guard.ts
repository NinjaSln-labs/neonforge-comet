import {
  DeepSeekModelPolicyError,
  isDeepSeekModelName,
  resolveDeepSeekModel
} from "../../deepseek/src/model-registry.ts";

export function assertDeepSeekWireModel(model: string): void {
  resolveDeepSeekModel(model);
}

// A provider can answer a DeepSeek request with a different model; never trust
// the response identity just because the outbound request was compliant.
export function assertDeepSeekResponseModel(model: unknown): void {
  if (typeof model !== "string" || !model.trim()) return;
  if (!isDeepSeekModelName(model)) {
    throw new DeepSeekModelPolicyError(
      `Provider responded with model "${model.trim()}", which is outside the allowed DeepSeek family.`
    );
  }
}
