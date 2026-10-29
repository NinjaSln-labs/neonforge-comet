import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { sourceRevision } from "../lib/source-revision.mjs";

export const BUNDLE_SCHEMA = "neonforge.release-evidence-bundle.v1";
export const INSTALLER_LIMIT = 50_000_000;

const platformDefinitions = [
  {
    platform: "linux",
    personaPlatform: "linux",
    personaArch: "x64"
  },
  {
    platform: "darwin",
    personaPlatform: "darwin",
    personaArch: "x64"
  },
  {
    platform: "windows",
    personaPlatform: "win32",
    personaArch: "x64"
  }
];

const evidenceDirectories = new Map([
  [
    "smoke",
    new Set(["linux-tui.json", "darwin-tui.json", "windows-tui.json"])
  ],
  [
    "e2e",
    new Set([
      "personas-linux-x64.json",
      "personas-darwin-x64.json",
      "personas-win32-x64.json"
    ])
  ],
  [
    "protocol-smoke",
    new Set([
      "openai-chat.json",
      "openai-responses.json",
      "anthropic-messages.json"
    ])
  ],
  ["benchmarks", new Set(["ab.json"])],
  [
    "installers",
    new Set([
      "neonforge-linux-x64.tgz",
      "neonforge-darwin-x64.tgz",
      "neonforge-windows-x64.tgz",
      "release-linux-x64.json",
      "release-darwin-x64.json",
      "release-windows-x64.json"
    ])
  ]
]);

export const REQUIRED_FILES = [
  { path: "source-manifest.json", source: "workspace", kind: "source-manifest" },
  { path: "LICENSE", source: "workspace", kind: "license" },
  {
    path: "THIRD_PARTY_NOTICES",
    source: "workspace",
    kind: "third-party-notices"
  },
  ...platformDefinitions.map(({ platform }) => ({
    path: `smoke/${platform}-tui.json`,
    source: "input",
    kind: "tui-smoke",
    platform
  })),
  ...platformDefinitions.map(({ platform, personaPlatform, personaArch }) => ({
    path: `e2e/personas-${personaPlatform}-${personaArch}.json`,
    source: "input",
    kind: "persona-e2e",
    platform,
    reportedPlatform: personaPlatform
  })),
  ...[
    "openai-chat",
    "openai-responses",
    "anthropic-messages"
  ].map((protocol) => ({
    path: `protocol-smoke/${protocol}.json`,
    source: "input",
    kind: "protocol-smoke",
    protocol
  })),
  { path: "benchmarks/ab.json", source: "input", kind: "ab-report" },
  ...platformDefinitions.map(({ platform }) => ({
    path: `installers/neonforge-${platform}-x64.tgz`,
    source: "input",
    kind: "installer",
    platform
  })),
  ...platformDefinitions.map(({ platform }) => ({
    path: `installers/release-${platform}-x64.json`,
    source: "input",
    kind: "release-evidence",
    platform
  }))
];

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function assertSafeRelativePath(path, label = "path") {
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error(`${label} must be a nonempty relative path`);
  }
  if (
    isAbsolute(path) ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("\\\\")
  ) {
    throw new Error(`${label} must not be absolute: ${path}`);
  }
  const normalized = path.replaceAll("\\", "/");
  if (normalized.split("/").includes("..") || normalized.startsWith("/")) {
    throw new Error(`${label} must not escape the bundle: ${path}`);
  }
  return normalized;
}

export function getGitCommit(workspaceRoot) {
  const result = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8"
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(result)) {
    throw new Error(`Could not resolve a Git commit at ${workspaceRoot}`);
  }
  return result;
}

export function validateEvidenceFile(entry, data, expectedRevision) {
  const label = entry.path;
  if (data?.workspaceRevision !== expectedRevision) {
    throw new Error(
      `${label} is stale: ${data?.workspaceRevision ?? "missing"} != ${expectedRevision}`
    );
  }

  if (entry.kind === "tui-smoke") {
    if (data.schema !== "neonforge.tui-smoke.v2") {
      throw new Error(`${label} has an unexpected schema`);
    }
    if (data.platform !== entry.platform || data.arch !== "x64") {
      throw new Error(`${label} does not come from ${entry.platform}-x64`);
    }
    if (data.passed !== true || data.results?.length !== 12) {
      throw new Error(`${label} is incomplete or failed`);
    }
    assertSafeRelativePath(data.personaReport, `${label} personaReport`);
    return;
  }

  if (entry.kind === "persona-e2e") {
    if (data.schema !== "neonforge.persona-e2e.v2") {
      throw new Error(`${label} has an unexpected schema`);
    }
    if (
      data.platform !== (entry.reportedPlatform ?? entry.platform) ||
      data.arch !== "x64"
    ) {
      throw new Error(
        `${label} does not come from ${entry.reportedPlatform ?? entry.platform}-x64`
      );
    }
    if (
      data.results?.length !== 12 ||
      !data.results.every(
        (result) =>
          result.passed === true &&
          Array.isArray(result.p0) &&
          result.p0.length === 0 &&
          Array.isArray(result.p1) &&
          result.p1.length === 0 &&
          result.evaluator?.verdict === "pass"
      ) ||
      data.tuiSmoke?.passed !== true
    ) {
      throw new Error(`${label} is incomplete or contains failed scenarios`);
    }
    return;
  }

  if (entry.kind === "protocol-smoke") {
    if (data.schema !== "neonforge.protocol-smoke.v2") {
      throw new Error(`${label} has an unexpected schema`);
    }
    if (
      data.protocol !== entry.protocol ||
      data.streaming !== true ||
      data.passed !== true
    ) {
      throw new Error(`${label} does not contain a passing streaming result`);
    }
    return;
  }

  if (entry.kind === "ab-report") {
    if (data.schema !== "neonforge.ab-paired-report.v2") {
      throw new Error(`${label} has an unexpected schema`);
    }
    if (
      data.pairedSamples < 6 ||
      data.summary?.costReduction < 0.15 ||
      data.summary?.timeReduction < 0.1 ||
      data.summary?.successRegressionPoints > 2
    ) {
      throw new Error(`${label} does not satisfy the A/B thresholds`);
    }
    return;
  }

  if (entry.kind === "release-evidence") {
    if (data.schema !== "neonforge.release-evidence.v1") {
      throw new Error(`${label} has an unexpected schema`);
    }
    if (data.platform !== entry.platform || data.arch !== "x64") {
      throw new Error(`${label} does not describe ${entry.platform}-x64`);
    }
    if (
      data.license !== "MIT" ||
      !Array.isArray(data.legalFiles) ||
      !["LICENSE", "THIRD_PARTY_NOTICES"].every((file) =>
        data.legalFiles.includes(file)
      )
    ) {
      throw new Error(`${label} is missing MIT legal-file metadata`);
    }
    assertSafeRelativePath(data.artifact, `${label} artifact`);
    if (
      data.artifact !==
      `dist/installers/neonforge-${entry.platform}-x64.tgz`
    ) {
      throw new Error(`${label} does not name its platform installer`);
    }
  }
}

export function inspectInstaller(path) {
  const entries = execFileSync("tar", ["-tzf", path], {
    encoding: "utf8"
  })
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\.\//, ""))
    .filter(Boolean);
  for (const required of ["LICENSE", "THIRD_PARTY_NOTICES", "package.json"]) {
    if (!entries.includes(required)) {
      throw new Error(`${path} is missing ${required}`);
    }
  }
  let packageText;
  try {
    packageText = execFileSync("tar", ["-xOf", path, "./package.json"], {
      encoding: "utf8"
    });
  } catch {
    packageText = execFileSync("tar", ["-xOf", path, "package.json"], {
      encoding: "utf8"
    });
  }
  const packageJson = JSON.parse(packageText);
  if (packageJson.license !== "MIT") {
    throw new Error(`${path} does not declare the MIT license`);
  }
  const bytes = statSync(path).size;
  if (bytes >= INSTALLER_LIMIT) {
    throw new Error(`${path} exceeds the installer size limit`);
  }
  return { bytes, entries };
}

export function assertNoCredentialMaterial(text, label) {
  if (/\bsk-[A-Za-z0-9_-]{12,}\b/.test(text)) {
    throw new Error(`${label} contains an API-key-shaped secret`);
  }
  if (/\bBearer\s+[A-Za-z0-9._-]{12,}\b/i.test(text)) {
    throw new Error(`${label} contains a bearer secret`);
  }
  const credentialField = /"(api[_-]?key|authorization|secret|access[_-]?token)"\s*:\s*"([^"]*)"/gi;
  for (const match of text.matchAll(credentialField)) {
    if (match[2] && !/^\*+$/.test(match[2])) {
      throw new Error(`${label} contains a non-redacted ${match[1]} field`);
    }
  }
}

export function assertNoUnexpectedEvidenceFiles(inputRoot) {
  for (const [directory, allowed] of evidenceDirectories) {
    const path = join(inputRoot, directory);
    if (!existsSync(path)) continue;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isFile() || !allowed.has(entry.name)) {
        throw new Error(`Unexpected evidence file: ${directory}/${entry.name}`);
      }
    }
  }
}

export function assembleEvidenceBundle({
  workspaceRoot,
  inputRoot,
  outputRoot,
  checks = [],
  gitCommit,
  generatedAt = new Date().toISOString()
}) {
  const workspace = resolve(workspaceRoot);
  const input = resolve(inputRoot);
  const output = resolve(outputRoot);
  if (output === workspace || output === input) {
    throw new Error("Evidence output must not replace the workspace or input root");
  }

  const revision = sourceRevision(workspace);
  const commit = gitCommit ?? getGitCommit(workspace);
  const packageJson = readJsonFile(join(workspace, "package.json"));
  assertNoUnexpectedEvidenceFiles(input);
  const staging = `${output}.tmp-${process.pid}-${Date.now()}`;
  const manifestFiles = [];
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, "files"), { recursive: true });

  try {
    for (const entry of REQUIRED_FILES) {
      const sourcePath = resolve(
        entry.source === "workspace" ? workspace : input,
        entry.path
      );
      if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
        throw new Error(`Missing required evidence file: ${entry.path}`);
      }
      if (
        [
          "tui-smoke",
          "persona-e2e",
          "protocol-smoke",
          "ab-report",
          "release-evidence"
        ].includes(entry.kind)
      ) {
        validateEvidenceFile(entry, readJsonFile(sourcePath), revision);
      }
      if (entry.kind === "installer") {
        inspectInstaller(sourcePath);
      }
      const destination = join(staging, "files", entry.path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(sourcePath, destination);
      const bytes = statSync(destination).size;
      manifestFiles.push({
        path: `files/${entry.path}`,
        kind: entry.kind,
        platform: entry.platform ?? null,
        sha256: sha256File(destination),
        bytes
      });
      if (!entry.path.endsWith(".tgz")) {
        assertNoCredentialMaterial(
          readFileSync(destination, "utf8"),
          `files/${entry.path}`
        );
      }
    }

    manifestFiles.sort((left, right) => compareText(left.path, right.path));
    const archive = `neonforge-release-evidence-${revision.slice(0, 12)}.tgz`;
    const manifest = {
      schema: BUNDLE_SCHEMA,
      applicationVersion: packageJson.version,
      sourceRevision: revision,
      gitCommit: commit,
      generatedAt,
      license: "MIT",
      legalFiles: ["LICENSE", "THIRD_PARTY_NOTICES"],
      platforms: Object.fromEntries(
        platformDefinitions.map(({ platform, personaPlatform }) => [
          platform,
          {
            smoke: `files/smoke/${platform}-tui.json`,
            personas: `files/e2e/personas-${personaPlatform}-x64.json`,
            installer: `files/installers/neonforge-${platform}-x64.tgz`
          }
        ])
      ),
      protocols: [
        "openai-chat",
        "openai-responses",
        "anthropic-messages"
      ],
      checks,
      archive,
      files: manifestFiles
    };
    writeFileSync(
      join(staging, "bundle.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    const sums = [
      `${sha256File(join(staging, "bundle.json"))}  bundle.json`,
      ...manifestFiles.map((file) => `${file.sha256}  ${file.path}`)
    ].sort();
    writeFileSync(join(staging, "SHA256SUMS"), `${sums.join("\n")}\n`);

    rmSync(output, { recursive: true, force: true });
    renameSync(staging, output);
    const archivePath = join(dirname(output), archive);
    rmSync(archivePath, { force: true });
    execFileSync("tar", ["-czf", archivePath, "-C", output, "."], {
      stdio: "inherit"
    });
    return { manifest, bundleRoot: output, archivePath };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export function verifyEvidenceBundle({
  bundlePath,
  workspaceRoot,
  gitCommit
}) {
  const workspace = resolve(workspaceRoot);
  const requested = resolve(bundlePath);
  let bundleRoot = requested;
  let temporaryRoot;
  if (statSync(requested).isFile()) {
    temporaryRoot = mkdtempSync(join(tmpdir(), "neonforge-evidence-verify-"));
    execFileSync("tar", ["-xzf", requested, "-C", temporaryRoot], {
      stdio: "pipe"
    });
    bundleRoot = temporaryRoot;
  }

  try {
    const manifestPath = join(bundleRoot, "bundle.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`Missing bundle manifest: ${manifestPath}`);
    }
    const manifest = readJsonFile(manifestPath);
    if (manifest.schema !== BUNDLE_SCHEMA) {
      throw new Error(`Unexpected bundle schema: ${manifest.schema}`);
    }
    const currentRevision = sourceRevision(workspace);
    if (manifest.sourceRevision !== currentRevision) {
      throw new Error(
        `Bundle source revision ${manifest.sourceRevision} does not match ${currentRevision}`
      );
    }
    const currentCommit = gitCommit ?? getGitCommit(workspace);
    if (manifest.gitCommit !== currentCommit) {
      throw new Error(
        `Bundle Git commit ${manifest.gitCommit} does not match ${currentCommit}`
      );
    }
    if (manifest.license !== "MIT") {
      throw new Error("Bundle does not declare the MIT license");
    }
    if (!Number.isFinite(Date.parse(manifest.generatedAt))) {
      throw new Error("Bundle generation time is not a valid timestamp");
    }
    for (const file of ["LICENSE", "THIRD_PARTY_NOTICES"]) {
      if (!manifest.legalFiles?.includes(file)) {
        throw new Error(`Bundle manifest is missing ${file}`);
      }
    }

    const byPath = new Map(manifest.files?.map((file) => [file.path, file]));
    if (byPath.size !== manifest.files?.length) {
      throw new Error("Bundle manifest contains duplicate file entries");
    }
    const expectedPaths = [...REQUIRED_FILES]
      .map((entry) => `files/${entry.path}`)
      .sort();
    const actualPaths = [...byPath.keys()].sort();
    if (
      expectedPaths.length !== actualPaths.length ||
      expectedPaths.some((path, index) => path !== actualPaths[index])
    ) {
      throw new Error("Bundle manifest does not contain exactly the required files");
    }
    const orderedPaths = manifest.files.map((file) => file.path);
    if (
      orderedPaths.some(
        (path, index) =>
          index > 0 && compareText(path, orderedPaths[index - 1]) < 0
      )
    ) {
      throw new Error("Bundle manifest files are not canonically ordered");
    }
    const expectedPlatforms = ["darwin", "linux", "windows"];
    const actualPlatforms = Object.keys(manifest.platforms ?? {}).sort();
    if (
      expectedPlatforms.length !== actualPlatforms.length ||
      expectedPlatforms.some(
        (platform, index) => platform !== actualPlatforms[index]
      )
    ) {
      throw new Error("Bundle does not cover exactly the required platforms");
    }
    const expectedProtocols = [
      "anthropic-messages",
      "openai-chat",
      "openai-responses"
    ];
    const actualProtocols = [...(manifest.protocols ?? [])].sort();
    if (
      expectedProtocols.length !== actualProtocols.length ||
      expectedProtocols.some(
        (protocol, index) => protocol !== actualProtocols[index]
      )
    ) {
      throw new Error("Bundle does not cover exactly the required protocols");
    }
    const bundleManifestBytes = readFileSync(
      join(bundleRoot, "files/source-manifest.json")
    );
    const workspaceManifestBytes = readFileSync(
      join(workspace, "source-manifest.json")
    );
    if (!bundleManifestBytes.equals(workspaceManifestBytes)) {
      throw new Error("Bundled source manifest differs from the checkout");
    }

    for (const entry of REQUIRED_FILES) {
      const relativePath = `files/${entry.path}`;
      assertSafeRelativePath(relativePath, "manifest file");
      const recorded = byPath.get(relativePath);
      const absolutePath = join(bundleRoot, relativePath);
      if (!existsSync(absolutePath)) {
        throw new Error(`Bundle is missing ${relativePath}`);
      }
      const bytes = statSync(absolutePath).size;
      const digest = sha256File(absolutePath);
      if (recorded.bytes !== bytes || recorded.sha256 !== digest) {
        throw new Error(`Bundle hash or size mismatch for ${relativePath}`);
      }
      if (entry.kind === "installer") {
        inspectInstaller(absolutePath);
      } else {
        const text = readFileSync(absolutePath, "utf8");
        assertNoCredentialMaterial(text, relativePath);
      }
      if (
        [
          "tui-smoke",
          "persona-e2e",
          "protocol-smoke",
          "ab-report",
          "release-evidence"
        ].includes(entry.kind)
      ) {
        validateEvidenceFile(
          entry,
          readJsonFile(absolutePath),
          manifest.sourceRevision
        );
      }
    }

    const checksumPath = join(bundleRoot, "SHA256SUMS");
    const checksumLines = readFileSync(checksumPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    const checksums = new Map();
    for (const line of checksumLines) {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
      if (!match) throw new Error(`Malformed SHA256SUMS line: ${line}`);
      checksums.set(match[2], match[1]);
    }
    const expectedChecksums = new Map([
      ["bundle.json", sha256File(manifestPath)],
      ...manifest.files.map((file) => [file.path, file.sha256])
    ]);
    if (
      expectedChecksums.size !== checksums.size ||
      [...expectedChecksums].some(
        ([path, hash]) => checksums.get(path) !== hash
      )
    ) {
      throw new Error("SHA256SUMS does not match bundle contents");
    }

    return {
      bundleRoot,
      sourceRevision: manifest.sourceRevision,
      gitCommit: manifest.gitCommit,
      files: manifest.files.length,
      platforms: Object.keys(manifest.platforms ?? {}),
      protocols: manifest.protocols ?? []
    };
  } finally {
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
