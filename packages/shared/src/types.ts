export type Protocol =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages";

export type ThinkingEffort = "low" | "high" | "max";
export type PermissionMode = "balanced" | "workspace-auto";
export type CapabilityName = "thinking" | "tools" | "vision" | "json";
export type SessionStatus =
  | "created"
  | "running"
  | "waiting-approval"
  | "cancelled"
  | "failed"
  | "completed";

export interface ModelCapabilities {
  thinking: boolean;
  tools: boolean;
  vision: boolean;
  json: boolean;
  contextTokens: number;
  maxOutputTokens: number;
}

export interface ProtocolCapabilities {
  thinking: boolean;
  tools: boolean;
  vision: boolean;
  json: boolean;
  streaming: boolean;
  maxOutputTokens: number;
}

export interface CanonicalModel {
  id: string;
  family: "deepseek";
  version: string;
  aliases: string[];
  capabilities: ModelCapabilities;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  protocol: Protocol;
  model: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  reasoningTokens?: number;
}

export interface ModelResponse {
  content: string;
  reasoningContent?: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason?: string;
  providerRequestId?: string;
  providerModel?: string;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  action: "write" | "command" | "network" | "destructive" | "credential" | "outside-workspace";
  title: string;
  detail: string;
  payload: Record<string, unknown>;
}

export interface ApprovalDecision {
  id: string;
  allowed: boolean;
  reason?: string;
  scope: "once" | "session";
}

export type SessionEventKind =
  | "session.created"
  | "turn.started"
  | "user.message"
  | "plan.updated"
  | "model.requested"
  | "model.selected"
  | "model.completed"
  | "model.failed"
  | "tool.requested"
  | "approval.requested"
  | "approval.resumed"
  | "approval.decided"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "artifact.recorded"
  | "session.cancelled"
  | "session.failed"
  | "session.completed";

export interface SessionEvent {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  kind: SessionEventKind;
  data: Record<string, unknown>;
}

export interface SessionRecord {
  id: string;
  objective: string;
  workspace: string;
  providerId: string;
  protocol: Protocol;
  providerModel: string;
  canonicalModel: string;
  modelSelectionReason: string;
  thinkingEffort: ThinkingEffort;
  permissionMode: PermissionMode;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  usage: Usage;
  lastError?: string;
}

export interface RunOptions {
  workspace: string;
  objective: string;
  provider: ProviderConfig;
  apiKey: string;
  canonicalModel: string;
  modelSelectionReason?: string;
  providerModel: string;
  thinkingEffort: ThinkingEffort;
  permissionMode: PermissionMode;
  sessionId?: string;
  maxTurns?: number;
  stream?: boolean;
  seed?: number;
  requiredCapabilities?: CapabilityName[];
}

export interface AgentEvent {
  kind: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface CheckResult {
  name: string;
  result: "passed" | "failed" | "not-run";
  note: string;
}

export interface ExternalBaselineSource {
  publisher: string;
  url: string;
  benchmarkVersion: string;
  modelVersion: string;
  retrievalDate: string;
  rawValues: Record<string, number | string>;
  units: Record<string, string>;
  aggregationMethod: string;
}

export interface ExternalBaselineSnapshot {
  schema: "neonforge.external-baseline.v1";
  canonicalModel: string;
  snapshotDate: string;
  sources: ExternalBaselineSource[];
  integrityHash: string;
}
