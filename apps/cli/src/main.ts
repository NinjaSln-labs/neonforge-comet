#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync } from "node:fs";
import {
  ApprovalRequiredError,
  SessionCancelledError,
  SessionStore,
  redact,
  runAgent
} from "../../../packages/core/src/index.ts";
import {
  defaultProvider,
  loadConfig,
  normalizeProtocol,
  ProviderConfigurationError,
  providerFromEnvironment,
  readSecret,
  resolveApiKey,
  resolveProvider,
  saveConfig,
  storeSecret,
  validateProvider,
  ensureHome
} from "../../../packages/config/src/index.ts";
import {
  DeepSeekModelPolicyError,
  chooseThinkingEffort,
  listModels,
  requiredCapabilitiesForObjective,
  resolveDeepSeekModel
} from "../../../packages/deepseek/src/index.ts";
import {
  createAdapter,
  UnsupportedCapabilityError,
  validateModelCapabilities
} from "../../../packages/protocols/src/index.ts";
import {
  listBaselineEntries,
  showBaselineEntry,
  verifyBaselineRegistry
} from "../../../packages/benchmarks/src/index.ts";
import { renderEvent } from "./render.ts";
import {
  ProviderSecretInputError,
  providerSecretForAdd
} from "./provider-secret.ts";
import type {
  ApprovalDecision,
  ApprovalRequest,
  PermissionMode,
  ProviderConfig,
  Protocol,
  SessionEvent,
  SessionRecord,
  ThinkingEffort
} from "../../../packages/shared/src/types.ts";

const EXIT = {
  success: 0,
  failure: 1,
  usage: 2,
  approvalRequired: 3,
  providerUnavailable: 4,
  cancelled: 5
} as const;

async function main(argv: string[]): Promise<number> {
  const [command = "help", ...rest] = argv;
  try {
    switch (command) {
      case "run":
        return await commandRun(rest);
      case "chat":
        return await commandChat(rest);
      case "provider":
        return await commandProvider(rest);
      case "models":
        return commandModels(rest);
      case "session":
        return await commandSession(rest);
      case "doctor":
        return commandDoctor();
      case "benchmark":
        return commandBenchmark(rest);
      case "help":
      case "--help":
      case "-h":
        printHelp();
        return EXIT.success;
      case "version":
      case "--version":
        console.log("neonforge 0.1.0");
        return EXIT.success;
      default:
        throw new UsageError(`Unknown command: ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`error: ${error.message}`);
      console.error("Run `neonforge help` for usage.");
      return EXIT.usage;
    }
    if (error instanceof ApprovalRequiredError) {
      printJson({
        type: "approval-required",
        sessionId: error.sessionId,
        request: error.request,
        next: `neonforge session resume ${error.sessionId}`
      });
      return EXIT.approvalRequired;
    }
    if (error instanceof SessionCancelledError) {
      console.error("Session cancelled.");
      return EXIT.cancelled;
    }
    if (error instanceof DeepSeekModelPolicyError) {
      console.error(`model policy error: ${redact(error.message)}`);
      return EXIT.providerUnavailable;
    }
    if (
      error instanceof ProviderConfigurationError ||
      error instanceof UnsupportedCapabilityError
    ) {
      console.error(`provider error: ${redact(error.message)}`);
      return EXIT.providerUnavailable;
    }
    console.error(`error: ${redact(error instanceof Error ? error.message : String(error))}`);
    return EXIT.failure;
  }
}

async function commandRun(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  const objective = parsed.positionals.join(" ").trim();
  if (!objective) throw new UsageError("run requires an objective.");

  const workspace = parsed.options.workspace ?? process.cwd();
  if (!existsSync(workspace)) throw new UsageError(`Workspace does not exist: ${workspace}`);

  const prepared = prepareProviderForRun(parsed.options, objective);
  const permissionMode = parsePermissionMode(parsed.options.permission);
  const thinkingEffort = parseThinkingEffort(parsed.options.thinking, objective);
  const seed = parseSeed(parsed.options.seed ?? process.env.NEONFORGE_SEED);
  const json = parsed.flags.has("json");
  const store = new SessionStore();
  const interactive = !json && process.stdin.isTTY;
  const rl = interactive
    ? createInterface({ input, output })
    : undefined;

  try {
    const result = await runAgent({
      workspace,
      objective,
      provider: prepared.provider,
      apiKey: prepared.apiKey,
      canonicalModel: prepared.selection.canonical.id,
      providerModel: prepared.requestedModel,
      modelSelectionReason: prepared.selection.reason,
      thinkingEffort,
      permissionMode,
      requiredCapabilities: prepared.requiredCapabilities,
      stream: parsed.flags.has("stream"),
      ...(seed !== undefined ? { seed } : {}),
      store,
      approve: interactive
        ? async (request, session) => promptApproval(rl!, request, session)
        : async (request, session) => {
            throw new ApprovalRequiredError(session.id, request);
          },
      onEvent: json
        ? (event) => printJson({ type: "event", event })
        : (event) => renderEvent(event)
    });
    if (json) {
      printJson({
        type: "result",
        session: result.session,
        content: result.finalText
      });
    } else {
      console.log(`\nSession ${result.session.id} completed.`);
    }
    return EXIT.success;
  } finally {
    rl?.close();
  }
}

async function commandChat(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  const rl = createInterface({ input, output });
  const store = new SessionStore();
  const workspace = parsed.options.workspace ?? process.cwd();
  let currentSession: SessionRecord | undefined;
  try {
    console.log("NeonForge CLI TUI. Type /exit to stop.");
    while (true) {
      let line: string;
      try {
        line = (await rl.question(currentSession ? "you > " : "task > ")).trim();
      } catch {
        break;
      }
      if (!line || line === "/exit" || line === "/quit") break;
      if (line === "/sessions") {
        for (const session of store.list().slice(0, 20)) {
          console.log(`${session.id}  ${session.status.padEnd(16)} ${session.objective}`);
        }
        continue;
      }
      const prepared = prepareProviderForRun(parsed.options, line);
      const seed = parseSeed(parsed.options.seed ?? process.env.NEONFORGE_SEED);
      const result = await runAgent({
        workspace,
        objective: line,
        provider: prepared.provider,
        apiKey: prepared.apiKey,
        canonicalModel: prepared.selection.canonical.id,
        providerModel: prepared.requestedModel,
        modelSelectionReason: prepared.selection.reason,
        thinkingEffort: parseThinkingEffort(parsed.options.thinking, line),
        permissionMode: parsePermissionMode(parsed.options.permission),
        requiredCapabilities: prepared.requiredCapabilities,
        stream: parsed.flags.has("stream"),
        ...(seed !== undefined ? { seed } : {}),
        store,
        ...(currentSession ? { sessionId: currentSession.id } : {}),
        resume: Boolean(currentSession),
        approve: (request, session) => promptApproval(rl, request, session),
        onEvent: renderEvent
      });
      currentSession = result.session;
    }
    return EXIT.success;
  } finally {
    rl.close();
  }
}

async function commandProvider(args: string[]): Promise<number> {
  const [subcommand = "list", ...rest] = args;
  const parsed = parseArgs(rest);
  const config = loadConfig();
  if (subcommand === "list") {
    if (!config.providers.length && !providerFromEnvironment()) {
      console.log("No providers configured.");
      return EXIT.success;
    }
    for (const provider of config.providers) {
      console.log(
        `${provider.id}\t${provider.protocol}\t${provider.baseUrl}\t${provider.model}\t${provider.name}`
      );
    }
    if (providerFromEnvironment()) console.log("environment\t(env)\tOPENAI_* or NEONFORGE_*");
    return EXIT.success;
  }
  if (subcommand === "add") {
    const id = parsed.options.id ?? parsed.positionals[0];
    const baseUrl = parsed.options["base-url"];
    const model = parsed.options.model;
    if (!id || !baseUrl || !model) {
      throw new UsageError("provider add requires --id, --base-url, and --model.");
    }
    const protocol = normalizeProtocol(parsed.options.protocol);
    const provider: ProviderConfig = {
      id,
      name: parsed.options.name ?? id,
      baseUrl,
      model,
      protocol
    };
    validateProvider(provider);
    resolveDeepSeekModel(model);
    let secret: string | undefined;
    try {
      secret = await providerSecretForAdd(parsed, input);
    } catch (error) {
      if (error instanceof ProviderSecretInputError) {
        throw new UsageError(error.message);
      }
      throw error;
    }
    if (secret) {
      provider.apiKeyRef = storeSecret(id, secret);
    }
    const providers = config.providers.filter((item) => item.id !== id);
    providers.push(provider);
    saveConfig({ ...config, providers });
    console.log(`Provider ${id} saved.`);
    return EXIT.success;
  }
  if (subcommand === "remove") {
    const id = parsed.options.id ?? parsed.positionals[0];
    if (!id) throw new UsageError("provider remove requires a provider id.");
    saveConfig({
      ...config,
      providers: config.providers.filter((item) => item.id !== id)
    });
    console.log(`Provider ${id} removed.`);
    return EXIT.success;
  }
  if (subcommand === "test") {
    const id = parsed.options.id ?? parsed.positionals[0];
    const provider = id ? resolveProvider(id, config) : defaultProvider(config);
    validateProvider(provider);
    resolveDeepSeekModel(provider.model);
    const apiKey = resolveApiKey(provider);
    const adapter = createAdapter(provider.protocol);
    validateModelCapabilities(
      resolveDeepSeekModel(provider.model).canonical,
      provider.protocol
    );
    await adapter.complete(provider, apiKey, {
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      tools: [],
      thinking: false,
      reasoningEffort: "low",
      maxOutputTokens: 8
    });
    console.log(`Provider ${provider.id} passed configuration and authentication checks.`);
    return EXIT.success;
  }
  throw new UsageError(`Unknown provider command: ${subcommand}`);
}

function commandModels(args: string[]): number {
  const json = args.includes("--json");
  const models = listModels();
  if (json) {
    printJson(models);
    return EXIT.success;
  }
  for (const model of models) {
    console.log(
      `${model.id}\t${model.version}\tcontext=${model.capabilities.contextTokens}\taliases=${model.aliases.join(",")}`
    );
  }
  return EXIT.success;
}

async function commandSession(args: string[]): Promise<number> {
  const [subcommand = "list", ...rest] = args;
  const parsed = parseArgs(rest);
  const store = new SessionStore();
  const id = parsed.options.id ?? parsed.positionals[0];
  if (subcommand === "list") {
    for (const session of store.list()) {
      console.log(
        `${session.id}\t${session.status}\t${session.updatedAt}\t${session.objective}`
      );
    }
    return EXIT.success;
  }
  if (!id) throw new UsageError(`session ${subcommand} requires a session id.`);
  if (subcommand === "show") {
    console.log(JSON.stringify(store.load(id), null, 2));
    for (const event of store.events(id)) console.log(JSON.stringify(event));
    return EXIT.success;
  }
  if (subcommand === "export") {
    printJson({ session: store.load(id), events: store.events(id) });
    return EXIT.success;
  }
  if (subcommand === "cancel") {
    const session = store.update(id, { status: "cancelled" });
    store.append(id, "session.cancelled", { reason: "cancelled by user" });
    console.log(`Session ${session.id} cancelled.`);
    return EXIT.success;
  }
  if (subcommand === "resume") {
    const session = store.load(id);
    const provider =
      session.providerId === "environment"
        ? providerFromEnvironment()
        : resolveProvider(session.providerId);
    if (!provider) {
      throw new Error("The environment provider is no longer available.");
    }
    const apiKey = resolveApiKey(provider);
    validateProvider(provider);
    const selection = resolveDeepSeekModel(session.providerModel);
    validateModelCapabilities(
      selection.canonical,
      provider.protocol,
      requiredCapabilitiesForObjective(session.objective)
    );
    const rl = createInterface({ input, output });
    try {
      const result = await runAgent({
        workspace: session.workspace,
        objective: session.objective,
        provider,
        apiKey,
        canonicalModel: session.canonicalModel,
        providerModel: session.providerModel,
        modelSelectionReason:
          session.modelSelectionReason ??
          `explicit canonical model ${session.canonicalModel}`,
        requiredCapabilities: requiredCapabilitiesForObjective(session.objective),
        thinkingEffort: session.thinkingEffort,
        permissionMode: session.permissionMode,
        store,
        sessionId: session.id,
        resume: true,
        approve: (request, current) => promptApproval(rl, request, current),
        onEvent: renderEvent
      });
      console.log(`\nSession ${result.session.id} completed.`);
      return EXIT.success;
    } finally {
      rl.close();
    }
  }
  throw new UsageError(`Unknown session command: ${subcommand}`);
}

function commandDoctor(): number {
  ensureHome();
  const config = loadConfig();
  const env = providerFromEnvironment();
  console.log(`node: ${process.version}`);
  console.log(`platform: ${process.platform} ${process.arch}`);
  console.log(`home: ${ensureHome()}`);
  console.log(`providers: ${config.providers.length + (env ? 1 : 0)}`);
  console.log(`config: ok`);
  console.log(`credentials: ${process.env.NEONFORGE_API_KEY || process.env.OPENAI_API_KEY ? "environment" : "unchecked"}`);
  return EXIT.success;
}

function commandBenchmark(args: string[]): number {
  const [subcommand = "list", ...rest] = args;
  const parsed = parseArgs(rest);
  const json = args.includes("--json");
  if (subcommand === "list") {
    const registry = verifyBaselineRegistry();
    const entries = listBaselineEntries();
    if (json) {
      printJson({
        registryOk: registry.ok,
        entries,
        candidates: registry.registry.candidates
      });
    } else {
      for (const entry of entries) {
        console.log(
          `${entry.id}\t${entry.status}\t${entry.kind}\t${entry.publisher}\t${entry.benchmarkVersion}`
        );
      }
      for (const candidate of registry.registry.candidates) {
        console.log(
          `${candidate.id}\t${candidate.status}\tstaged\t${candidate.suite}`
        );
      }
    }
    return registry.ok ? EXIT.success : EXIT.failure;
  }
  if (subcommand === "show") {
    const id = parsed.positionals[0] ?? parsed.options.id;
    if (!id) throw new UsageError("benchmark show requires a baseline id.");
    printJson(showBaselineEntry(id));
    return EXIT.success;
  }
  if (subcommand === "verify") {
    const result = verifyBaselineRegistry();
    if (json) {
      printJson(result);
    } else if (result.ok) {
      console.log(
        `Baseline registry verified: ${result.registry.entries.length} entries, ` +
          `${result.registry.candidates.length} staged candidates.`
      );
    } else {
      for (const issue of result.issues) {
        console.error(`${issue.code}: ${issue.message}`);
      }
    }
    return result.ok ? EXIT.success : EXIT.failure;
  }
  throw new UsageError(`Unknown benchmark command: ${subcommand}`);
}

async function promptApproval(
  rl: ReturnType<typeof createInterface>,
  request: ApprovalRequest,
  _session: SessionRecord
): Promise<ApprovalDecision> {
  console.log(`\n[approval] ${request.title}`);
  console.log(request.detail);
  const answer = (await rl.question("Allow? [y/N/s=session] ")).trim().toLowerCase();
  return {
    id: request.id,
    allowed: answer === "y" || answer === "s",
    scope: answer === "s" ? "session" : "once",
    ...(answer === "n" ? { reason: "denied by user" } : {})
  };
}

function resolveProviderForRun(options: Record<string, string>): ProviderConfig {
  if (options.provider) return resolveProvider(options.provider);
  const env = providerFromEnvironment();
  if (env) return env;
  return defaultProvider();
}

function prepareProviderForRun(
  options: Record<string, string>,
  objective: string
): {
  provider: ProviderConfig;
  apiKey: string;
  requestedModel: string;
  selection: ReturnType<typeof resolveDeepSeekModel>;
  requiredCapabilities: ReturnType<typeof requiredCapabilitiesForObjective>;
} {
  const baseProvider = resolveProviderForRun(options);
  const protocol = normalizeProtocol(options.protocol ?? baseProvider.protocol);
  const provider = { ...baseProvider, protocol };
  validateProvider(provider);
  const requestedModel = options.model ?? provider.model;
  const selection = resolveDeepSeekModel(requestedModel);
  const requiredCapabilities = requiredCapabilitiesForObjective(objective);
  validateModelCapabilities(
    selection.canonical,
    provider.protocol,
    requiredCapabilities
  );
  const apiKey = resolveApiKey(provider);
  return {
    provider,
    apiKey,
    requestedModel,
    selection,
    requiredCapabilities
  };
}

function parsePermissionMode(value: string | undefined): PermissionMode {
  if (!value) return "balanced";
  if (value === "balanced" || value === "workspace-auto") return value;
  throw new UsageError("--permission must be balanced or workspace-auto.");
}

function parseThinkingEffort(
  value: string | undefined,
  objective: string
): ThinkingEffort {
  if (!value) return chooseThinkingEffort(objective);
  if (value === "low" || value === "high" || value === "max") return value;
  throw new UsageError("--thinking must be low, high, or max.");
}

function parseSeed(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new UsageError("--seed must be a non-negative integer.");
  }
  return seed;
}

class UsageError extends Error {}

function parseArgs(args: string[]): {
  positionals: string[];
  options: Record<string, string>;
  flags: Set<string>;
} {
  const positionals: string[] = [];
  const options: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.add(key);
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return { positionals, options, flags };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printHelp(): void {
  console.log(`NeonForge 0.1.0

Usage:
  neonforge run <objective> [--workspace <path>] [--provider <id>]
      [--model auto|<canonical-id>] [--protocol openai-chat|openai-responses|anthropic-messages]
      [--thinking low|high|max] [--permission balanced|workspace-auto] [--json]
      [--seed <integer>] [--stream]
  neonforge chat [--workspace <path>] [--provider <id>]
  neonforge provider list|add|test|remove
      provider add: pipe the key with --api-key-stdin; --api-key is rejected
  neonforge models list [--json]
  neonforge benchmark list|show|verify [<id>] [--json]
  neonforge session list|show|resume|cancel|export <id>
  neonforge doctor

Environment:
  NEONFORGE_BASE_URL, NEONFORGE_API_KEY, NEONFORGE_MODEL, NEONFORGE_PROTOCOL
  OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL
`);
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
