export const BUNDLE_SCHEMA: string;
export const INSTALLER_LIMIT: number;

export interface EvidenceFileSpec {
  path: string;
  source: "workspace" | "input";
  kind: string;
  platform?: string;
  reportedPlatform?: string;
  protocol?: string;
}

export interface EvidenceManifestFile {
  path: string;
  kind: string;
  platform: string | null;
  sha256: string;
  bytes: number;
}

export interface EvidenceManifest {
  schema: string;
  applicationVersion: string;
  sourceRevision: string;
  gitCommit: string;
  generatedAt: string;
  license: string;
  legalFiles: string[];
  platforms: Record<
    string,
    { smoke: string; personas: string; installer: string }
  >;
  protocols: string[];
  checks: Array<Record<string, unknown>>;
  archive: string;
  files: EvidenceManifestFile[];
}

export const REQUIRED_FILES: EvidenceFileSpec[];
export function sha256File(path: string): string;
export function readJsonFile(path: string): unknown;
export function assertSafeRelativePath(path: string, label?: string): string;
export function getGitCommit(workspaceRoot: string): string;
export function validateEvidenceFile(
  entry: EvidenceFileSpec,
  data: Record<string, any>,
  expectedRevision: string
): void;
export function inspectInstaller(path: string): {
  bytes: number;
  entries: string[];
};
export function assertNoCredentialMaterial(text: string, label: string): void;
export function assertNoUnexpectedEvidenceFiles(inputRoot: string): void;
export function assembleEvidenceBundle(options: {
  workspaceRoot: string;
  inputRoot: string;
  outputRoot: string;
  checks?: Array<Record<string, unknown>>;
  gitCommit?: string;
  generatedAt?: string;
}): {
  manifest: EvidenceManifest;
  bundleRoot: string;
  archivePath: string;
};
export function verifyEvidenceBundle(options: {
  bundlePath: string;
  workspaceRoot: string;
  gitCommit?: string;
}): {
  bundleRoot: string;
  sourceRevision: string;
  gitCommit: string;
  files: number;
  platforms: string[];
  protocols: string[];
};
