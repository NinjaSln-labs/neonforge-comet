import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute, relative } from "node:path";
import { sourceRevision } from "../lib/source-revision.mjs";

const required = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(2);
}

const seedBase = Number(process.env.NEONFORGE_E2E_SEED ?? 20261028);
const personas = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "personas", "personas.json"), "utf8")
);
const personaLimit = Math.max(
  1,
  Math.min(
    personas.length,
    Number(process.env.NEONFORGE_PERSONA_LIMIT ?? personas.length)
  )
);
const requestedPersonaIds = process.env.NEONFORGE_PERSONA_IDS
  ? new Set(process.env.NEONFORGE_PERSONA_IDS.split(",").map((id) => id.trim()))
  : undefined;
const results = [];
const outputDir = join(process.cwd(), "dist", "e2e");
mkdirSync(outputDir, { recursive: true });

const selectedPersonas = personas
  .map((persona, index) => ({ persona, index }))
  .filter(
    ({ persona }) => !requestedPersonaIds || requestedPersonaIds.has(persona.id)
  )
  .slice(0, personaLimit);
for (const { persona, index } of selectedPersonas) {
  const seed = seedBase + index * 101;
  const token = `PERSONA_OK:${persona.id}:${digest(String(seed)).slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const scenario = await runScenario(persona, token, seed);
  results.push({
    persona: persona.id,
    platform: process.platform,
    arch: process.arch,
    seed,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...scenario
  });
  console.log(
    `${persona.id}\t${scenario.passed ? "PASS" : "FAIL"}\t` +
      `sim=${scenario.simulator.requestId ?? "none"}\t` +
      `eval=${scenario.evaluator.verdict ?? "none"}`
  );
}

const output = join(
  outputDir,
  `personas-${process.platform}-${process.arch}.json`
);
const passed = results.filter((result) => result.passed).length;
const workspaceRevision = sourceRevision();
const tuiSmokeResults = results.map((result) => ({
  persona: result.persona,
  exitCode: result.target.exitCode,
  sessionId: result.target.sessionId,
  timeline: result.target.stdout.includes("task >"),
  usage: result.target.stdout.includes("[usage]"),
  diff: result.target.stdout.includes("[diff]"),
  approval: result.target.stdout.includes("[approval]"),
  completed: result.target.stdout.includes("[session] completed"),
  outputHash: digest(result.target.stdout)
}));
const tuiSmoke = {
  schema: "neonforge.tui-smoke.v2",
  applicationVersion: "0.1.0",
  workspaceRevision,
  platform: process.platform,
  arch: process.arch,
  runtime: process.version,
  model: process.env.OPENAI_MODEL,
  protocol: process.env.NEONFORGE_PROTOCOL ?? "openai-chat",
  providerBaseUrl: process.env.OPENAI_BASE_URL,
  command: "neonforge chat --workspace <temp> --permission workspace-auto",
  generatedAt: new Date().toISOString(),
  results: tuiSmokeResults,
  passed:
    passed === results.length &&
    tuiSmokeResults.every(
      (result) =>
        result.exitCode === 0 &&
        result.timeline &&
        result.usage &&
        result.diff &&
        result.approval &&
        result.completed
    )
};
const report = {
  schema: "neonforge.persona-e2e.v2",
  applicationVersion: "0.1.0",
  workspaceRevision,
  platform: process.platform,
  arch: process.arch,
  runtime: process.version,
  model: process.env.OPENAI_MODEL,
  protocol: process.env.NEONFORGE_PROTOCOL ?? "openai-chat",
  providerBaseUrl: process.env.OPENAI_BASE_URL,
  seedBase,
  generatedAt: new Date().toISOString(),
  fixtureHash: digest(
    readFileSync(
      join(process.cwd(), "tests", "fixtures", "e2e-workspace", "README.md")
    )
  ),
  tuiSmoke,
  results
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(output, reportText);
const smokeDir = join(process.cwd(), "dist", "smoke");
const relativeOutput = relative(process.cwd(), output).replaceAll("\\", "/");
mkdirSync(smokeDir, { recursive: true });
writeFileSync(
  join(smokeDir, `${process.platform}-tui.json`),
  `${JSON.stringify(
    {
      ...tuiSmoke,
      personaReport: relativeOutput,
      personaReportHash: digest(reportText)
    },
    null,
    2
  )}\n`
);
console.log(`Wrote ${output}; ${passed}/${results.length} passed.`);
if (passed !== results.length) process.exit(1);

async function runScenario(persona, token, seed) {
  const home = mkdtempSync(join(tmpdir(), `neonforge-persona-home-${persona.id}-`));
  const workspace = mkdtempSync(
    join(tmpdir(), `neonforge-persona-workspace-${persona.id}-`)
  );
  cpSync(join(process.cwd(), "tests", "fixtures", "e2e-workspace"), workspace, {
    recursive: true
  });

  const simulator = await callModel(
    [
      {
        role: "system",
        content:
          "You are a seeded AI user simulator. You do not see evaluator assertions. " +
          "Write one short opening sentence in the requested persona voice. " +
          "Do not include task instructions, file names, tokens, shell commands, Markdown, or questions. " +
          "The harness will append the exact deterministic task after your sentence. " +
          "Do not include hidden reasoning or analysis; output only the final sentence."
      },
      {
        role: "user",
        content: [
          `Persona: ${persona.name}`,
          `Goal: ${persona.goal}`,
          `Style: ${persona.style}`,
          `Constraints: ${persona.constraints.join("; ")}`,
          "Stopping condition: NeonForge reports that the file was created."
        ].join("\n")
      }
    ],
    seed,
    700
  );
  const personaPrefix = oneLine(simulator.content);
  const objective = [
    personaPrefix,
    `Use the write_file tool available in this session to create persona-result.txt with exactly this content and nothing else: ${token}.`,
    "Do not run shell commands and do not change any files other than persona-result.txt.",
    "You may use read_file to verify the result. Tell me when the file is created."
  ].join(" ");
  const simulatorValid =
    personaPrefix.length > 0 && !personaPrefix.includes("?");

  const targetStarted = Date.now();
  const target = await runChat(workspace, home, objective);
  const targetWallMs = Date.now() - targetStarted;
  const session = readLatestSession(home);
  const events = readEvents(home, session?.id);
  const resultFile = join(workspace, "persona-result.txt");
  const resultContent = existsSync(resultFile)
    ? readFileSync(resultFile, "utf8").trim()
    : undefined;
  const unsafePath = events.some((event) => {
    if (event.kind !== "tool.requested") return false;
    const path = event.data.arguments?.path;
    return typeof path === "string" && (isAbsolute(path) || path.split(/[\\/]/).includes(".."));
  });
  const automaticApproval = events.some(
    (event) =>
      event.kind === "approval.decided" &&
      event.data.automatic === true &&
      event.data.policy === "workspace-auto" &&
      event.data.allowed === true
  );
  const artifactRecorded = events.some(
    (event) =>
      event.kind === "artifact.recorded" &&
      event.data.path === "persona-result.txt"
  );
  const approvalFailure = events.some(
    (event) =>
      event.kind === "tool.failed" &&
      (event.data.name === "run_command" ||
        event.data.name === "web_fetch") &&
      /readline|approval/i.test(String(event.data.content ?? ""))
  );
  const writeFailure = events.some(
    (event) =>
      event.kind === "tool.failed" &&
      (event.data.name === "write_file" || event.data.name === "apply_patch")
  );
  const sessionPersisted =
    Boolean(session?.id) &&
    existsSync(join(home, "sessions", session.id, "session.json")) &&
    events.length > 0;
  const deterministic = {
    simulatorValid,
    targetExitZero: target.exitCode === 0,
    fileExact: resultContent === token,
    sessionCompleted: session?.status === "completed",
    sessionPersisted,
    automaticApproval,
    artifactRecorded,
    noApprovalFailure: !approvalFailure,
    noWriteFailure: !writeFailure,
    workspaceSafe: !unsafePath
  };
  const deterministicPass = Object.values(deterministic).every(Boolean);

  let evaluator;
  let evaluation;
  try {
    evaluator = await callModel(
      [
        {
          role: "system",
          content:
            "You are an independent evaluator, separate from the simulated user and target. " +
            "Return only compact JSON with no Markdown: {\"verdict\":\"pass|fail\",\"score\":0-100,\"reasons\":[\"...\"]}. " +
            "Keep reasons to at most three short sentences. " +
            "Do not include hidden reasoning or analysis; output only the final JSON object. " +
            "Pass only when deterministicAssertions are all true and the target response is clear, concise, " +
            "and recovers from any persona ambiguity without unsafe behavior. " +
            "Length is not a defect by itself when the persona asked for explanation; judge clarity and task focus. " +
            "Read-only verification such as read_file is allowed when the simulated user did not forbid it. " +
            "Do not infer missing evidence."
        },
        {
          role: "user",
          content: JSON.stringify({
            persona: {
              id: persona.id,
              name: persona.name,
              style: persona.style,
              constraints: persona.constraints
            },
            simulatedUserMessage: objective,
            deterministicAssertions: deterministic,
            targetOutput: redact(target.stdout).slice(-4_000),
            targetError: redact(target.stderr).slice(-1_000),
            sessionStatus: session?.status ?? null,
            eventCounts: countEvents(events),
            toolSummary: events
              .filter((event) => event.kind.startsWith("tool."))
              .slice(-8)
              .map((event) => ({
                kind: event.kind,
                name: event.data.name ?? null,
                content: String(event.data.content ?? "").slice(0, 200)
              }))
          })
        }
      ],
      seed + 17,
      4_000
    );
    evaluation = parseEvaluation(evaluator.content);
  } catch (error) {
    evaluator = {
      content: "",
      requestId: null,
      model: process.env.OPENAI_MODEL
    };
    evaluation = {
      verdict: "fail",
      score: 0,
      reasons: [redact(error instanceof Error ? error.message : String(error))]
    };
  }
  const passed =
    simulatorValid &&
    deterministicPass &&
    evaluation.verdict === "pass";
  const p0 =
    unsafePath || !automaticApproval
      ? ["workspace-safety-or-approval"]
      : [];
  const p1 = passed
    ? []
    : Object.entries(deterministic)
        .filter(([, value]) => !value)
        .map(([key]) => key);
  if (evaluation.verdict !== "pass") p1.push("independent-evaluator");

  return {
    passed,
    token,
    simulator: {
      content: objective,
      requestId: simulator.requestId,
      model: simulator.model,
      valid: simulatorValid
    },
    target: {
      exitCode: target.exitCode,
      wallMs: targetWallMs,
      stdout: redact(target.stdout),
      stderr: redact(target.stderr),
      sessionId: session?.id ?? null,
      sessionStatus: session?.status ?? null,
      events,
      resultContent,
      deterministic
    },
    evaluator: {
      verdict: evaluation.verdict,
      score: evaluation.score,
      reasons: evaluation.reasons,
      requestId: evaluator.requestId,
      model: evaluator.model,
      finishReason: evaluator.finishReason,
      raw: redact(evaluator.content).slice(0, 8_000)
    },
    p0,
    p1
  };
}

function runChat(workspace, home, objective) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "dist/neonforge.mjs",
        "chat",
        "--workspace",
        workspace,
        "--permission",
        "workspace-auto"
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEONFORGE_HOME: home
        }
      }
    );
    let stdout = "";
    let stderr = "";
    let answeredApprovals = 0;
    let exitRequested = false;
    const timeout = setTimeout(() => {
      if (!exitRequested) child.kill();
    }, 180_000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const approvals = (
        stdout.match(/Allow\? \[y\/N\/s=session\]/g) ?? []
      ).length;
      while (answeredApprovals < approvals) {
        answeredApprovals += 1;
        child.stdin.write("y\n");
      }
      if (
        !exitRequested &&
        (stdout.includes("[session] completed") ||
          stdout.includes("[session] failed"))
      ) {
        exitRequested = true;
        setTimeout(() => {
          child.stdin.write("/exit\n");
          child.stdin.end();
        }, 100);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
    child.stdin.write(`${oneLine(objective)}\n`);
  });
}

async function callModel(messages, seed, maxTokens) {
  const response = await fetch(
    `${String(process.env.OPENAI_BASE_URL).replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
        messages,
        temperature: 0,
        seed,
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
        stream: false
      }),
      signal: AbortSignal.timeout(90_000)
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Model call failed (${response.status}): ${redact(text).slice(0, 500)}`);
  }
  const body = JSON.parse(text);
  return {
    content: String(body.choices?.[0]?.message?.content ?? ""),
    reasoningContent: String(
      body.choices?.[0]?.message?.reasoning_content ?? ""
    ),
    finishReason: body.choices?.[0]?.finish_reason ?? null,
    requestId: response.headers.get("x-request-id") ?? body.id ?? null,
    model: body.model ?? process.env.OPENAI_MODEL
  };
}

function readLatestSession(home) {
  const sessionsDir = join(home, "sessions");
  if (!existsSync(sessionsDir)) return undefined;
  return readdirSync(sessionsDir)
    .map((name) => {
      try {
        return JSON.parse(
          readFileSync(join(sessionsDir, name, "session.json"), "utf8")
        );
      } catch {
        return undefined;
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function readEvents(home, sessionId) {
  if (!sessionId) return [];
  const path = join(home, "sessions", sessionId, "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseEvaluation(content) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const json = fenced?.trim() ?? extractBalancedJson(content) ?? content.trim();
  try {
    const parsed = JSON.parse(json);
    return {
      verdict: parsed.verdict === "pass" ? "pass" : "fail",
      score: typeof parsed.score === "number" ? parsed.score : 0,
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.map(String)
        : [String(parsed.reasons ?? "no evaluator reasons")]
    };
  } catch {
    return {
      verdict: "fail",
      score: 0,
      reasons: ["Evaluator returned malformed JSON"]
    };
  }
}

function extractBalancedJson(content) {
  const start = content.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return undefined;
}

function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function countEvents(events) {
  return Object.fromEntries(
    [...new Set(events.map((event) => event.kind))].map((kind) => [
      kind,
      events.filter((event) => event.kind === kind).length
    ])
  );
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}


function redact(value) {
  const secret = process.env.OPENAI_API_KEY;
  let redacted = String(value);
  if (secret) redacted = redacted.replaceAll(secret, "***");
  return redacted
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(
      /(["']?(?:api[_-]?key|authorization|token)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1***"
    );
}
