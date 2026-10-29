import type { ToolDefinition } from "../../shared/src/types.ts";
import type { ThinkingEffort } from "../../shared/src/types.ts";

export const SYSTEM_PROMPT_VERSION = "neonforge-agent-v1";

const STATIC_INSTRUCTIONS = `You are NeonForge, a local-first technical work agent.
Work only inside the selected workspace. Use tools for concrete actions. Read before editing.
Explain consequential actions precisely. Ask for approval only through the tool broker.
Keep working until the objective is complete, blocked, or needs user input.
Prefer small, verifiable changes and report the evidence you actually observed.`;

export function buildStableSystemPrefix(tools: readonly ToolDefinition[]): string {
  const orderedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const toolList = orderedTools
    .map((tool) => `${tool.name}: ${tool.description}`)
    .join("\n");
  const baselineNonce =
    process.env.NEONFORGE_DISABLE_OPTIMIZATIONS === "1"
      ? `\nBaseline nonce: ${crypto.randomUUID()} ${Date.now()}`
      : "";
  const stableContext = process.env.NEONFORGE_STABLE_CONTEXT
    ? `\nStable project context:\n${process.env.NEONFORGE_STABLE_CONTEXT}`
    : "";
  const optimizationGuidance =
    process.env.NEONFORGE_DISABLE_OPTIMIZATIONS === "1"
      ? "\nBaseline policy: execute exactly one tool call per assistant turn. Do not batch independent tools and do not add confirmation-only model turns."
      : "\nOptimization policy: for unambiguous workspace tasks, batch independent tool calls in one assistant message and use the fewest safe tool turns. When the user supplies all content required for a write, issue the independent reads and the write in the same turn. Do not add confirmation-only model turns.";
  return `${STATIC_INSTRUCTIONS}\nRuntime prompt: ${SYSTEM_PROMPT_VERSION}${baselineNonce}\nTools:\n${toolList}${optimizationGuidance}${stableContext}`;
}

export function chooseThinkingEffort(
  objective: string,
  requested?: ThinkingEffort
): ThinkingEffort {
  if (requested) return requested;
  const complex =
    objective.length > 400 ||
    /architect|refactor|debug|migrat|security|analy|design|\bplan\b|复杂|架构|重构|排查|迁移|安全|设计|分析/i.test(
      objective
    );
  return complex ? "high" : "low";
}
