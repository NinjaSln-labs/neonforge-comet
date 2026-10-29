import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, platform as currentPlatform } from "node:os";
import { join } from "node:path";
import type { ProviderConfig, Protocol } from "../../shared/src/types.ts";

export interface NeonForgeConfig {
  schema: "neonforge.config.v1";
  providers: ProviderConfig[];
}

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

export function neonForgeHome(): string {
  return process.env.NEONFORGE_HOME || join(homedir(), ".neonforge");
}

export function ensureHome(): string {
  const home = neonForgeHome();
  mkdirSync(join(home, "sessions"), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, "artifacts"), { recursive: true, mode: 0o700 });
  return home;
}

export function configPath(): string {
  return join(neonForgeHome(), "config.json");
}

export function loadConfig(): NeonForgeConfig {
  const path = configPath();
  if (!existsSync(path)) {
    return { schema: "neonforge.config.v1", providers: [] };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<NeonForgeConfig>;
  if (parsed.schema !== "neonforge.config.v1" || !Array.isArray(parsed.providers)) {
    throw new Error(`Invalid NeonForge config at ${path}`);
  }
  return parsed as NeonForgeConfig;
}

export function saveConfig(config: NeonForgeConfig): void {
  ensureHome();
  const target = configPath();
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(target, readFileSync(temporary), { mode: 0o600 });
}

export function resolveProvider(
  idOrName: string,
  config = loadConfig()
): ProviderConfig {
  const provider = config.providers.find(
    (item) => item.id === idOrName || item.name === idOrName
  );
  if (!provider) throw new Error(`Provider "${idOrName}" is not configured.`);
  return provider;
}

export function defaultProvider(config = loadConfig()): ProviderConfig {
  const provider =
    config.providers.find((item) => item.id === "deepseek") ?? config.providers[0];
  if (!provider) {
    throw new Error(
      "No provider configured. Add one with `neonforge provider add` or set OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL."
    );
  }
  return provider;
}

export function providerFromEnvironment(): ProviderConfig | undefined {
  const baseUrl = process.env.NEONFORGE_BASE_URL ?? process.env.OPENAI_BASE_URL;
  const model = process.env.NEONFORGE_MODEL ?? process.env.OPENAI_MODEL;
  if (!baseUrl || !model) return undefined;
  const protocol = normalizeProtocol(process.env.NEONFORGE_PROTOCOL);
  return {
    id: "environment",
    name: "Environment provider",
    baseUrl,
    protocol,
    model,
    apiKeyRef: "environment"
  };
}

export function resolveApiKey(provider: ProviderConfig): string {
  const explicit = process.env.NEONFORGE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (explicit) return explicit;
  if (provider.apiKeyRef && provider.apiKeyRef !== "environment") {
    return readSecret(provider.apiKeyRef);
  }
  throw new ProviderConfigurationError(
    "API key is missing. Set NEONFORGE_API_KEY or OPENAI_API_KEY, or store a provider key with `neonforge provider add`."
  );
}

export function normalizeProtocol(value: string | undefined): Protocol {
  if (!value) return "openai-chat";
  if (
    value === "openai-chat" ||
    value === "openai-responses" ||
    value === "anthropic-messages"
  ) {
    return value;
  }
  throw new ProviderConfigurationError(`Unsupported protocol "${value}".`);
}

export function validateProvider(provider: ProviderConfig): void {
  let url: URL;
  try {
    url = new URL(provider.baseUrl);
  } catch {
    throw new ProviderConfigurationError(
      `Provider base URL is not a valid absolute URL: ${provider.baseUrl}`
    );
  }
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new ProviderConfigurationError(
      "Provider base URL must use HTTPS; loopback HTTP is allowed."
    );
  }
  if (url.username || url.password) {
    throw new ProviderConfigurationError(
      "Provider base URL must not contain credentials."
    );
  }
  if (!provider.model.trim()) {
    throw new ProviderConfigurationError("Provider model must not be empty.");
  }
  normalizeProtocol(provider.protocol);
}

function secretServiceName(providerId: string): string {
  return `neonforge:${providerId}`;
}

export interface SecretStore {
  storeSecret(providerId: string, secret: string): string;
  readSecret(service: string): string;
}

interface SecretCommandOptions {
  input?: string;
}

type SecretCommand = (
  file: string,
  args: string[],
  options?: SecretCommandOptions
) => string;

export interface SecretStoreDependencies {
  platform: () => NodeJS.Platform;
  exec: SecretCommand;
}

function runSecretCommand(
  file: string,
  args: string[],
  options: SecretCommandOptions = {}
): string {
  return execFileSync(file, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options
  });
}

export function createSecretStore(
  overrides: Partial<SecretStoreDependencies> = {}
): SecretStore {
  const dependencies: SecretStoreDependencies = {
    platform: currentPlatform,
    exec: runSecretCommand,
    ...overrides
  };

  return {
    storeSecret(providerId, secret) {
      const service = secretServiceName(providerId);
      const platformName = dependencies.platform();
      if (platformName === "darwin") {
        dependencies.exec("security", [
          "add-generic-password",
          "-a",
          providerId,
          "-s",
          service,
          "-w",
          secret,
          "-U"
        ]);
      } else if (platformName === "linux") {
        dependencies.exec(
          "secret-tool",
          ["store", "--label", service, "service", service, "account", providerId],
          { input: secret }
        );
      } else if (platformName === "win32") {
        dependencies.exec(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            WINDOWS_CREDENTIAL_COMMAND
          ],
          {
            input: JSON.stringify({
              action: "store",
              target: service,
              user: providerId,
              secret
            })
          }
        );
      } else {
        throw new Error(`Unsupported secret-store platform: ${platformName}`);
      }
      return service;
    },

    readSecret(service) {
      const platformName = dependencies.platform();
      if (platformName === "darwin") {
        return dependencies
          .exec("security", ["find-generic-password", "-s", service, "-w"])
          .trim();
      }
      if (platformName === "linux") {
        return dependencies
          .exec("secret-tool", ["lookup", "service", service])
          .trim();
      }
      if (platformName === "win32") {
        const encoded = dependencies.exec(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            WINDOWS_CREDENTIAL_COMMAND
          ],
          {
            input: JSON.stringify({ action: "read", target: service })
          }
        );
        return Buffer.from(encoded.trim(), "base64").toString("utf8");
      }
      throw new Error(
        `Stored secrets are unavailable on ${platformName}; set NEONFORGE_API_KEY instead.`
      );
    }
  };
}

const systemSecretStore = createSecretStore();

export function storeSecret(providerId: string, secret: string): string {
  return systemSecretStore.storeSecret(providerId, secret);
}

export function readSecret(service: string): string {
  return systemSecretStore.readSecret(service);
}

const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$null = Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NeonForgeCredential
{
    private const uint GenericCredential = 1;
    private const uint PersistLocalMachine = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr credential);

    public static void Store(string target, string user, string secret)
    {
        IntPtr targetPtr = Marshal.StringToCoTaskMemUni(target);
        IntPtr userPtr = Marshal.StringToCoTaskMemUni(user);
        byte[] secretBytes = Encoding.Unicode.GetBytes(secret);
        IntPtr secretPtr = Marshal.AllocCoTaskMem(secretBytes.Length);
        try
        {
            Marshal.Copy(secretBytes, 0, secretPtr, secretBytes.Length);
            var credential = new CREDENTIAL
            {
                Type = GenericCredential,
                TargetName = targetPtr,
                CredentialBlobSize = (uint)secretBytes.Length,
                CredentialBlob = secretPtr,
                Persist = PersistLocalMachine,
                UserName = userPtr
            };
            if (!CredWrite(ref credential, 0))
            {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            Marshal.FreeCoTaskMem(targetPtr);
            Marshal.FreeCoTaskMem(userPtr);
            Marshal.FreeCoTaskMem(secretPtr);
        }
    }

    public static string Read(string target)
    {
        IntPtr credentialPtr;
        if (!CredRead(target, GenericCredential, 0, out credentialPtr))
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        try
        {
            var credential = (CREDENTIAL)Marshal.PtrToStructure(
                credentialPtr,
                typeof(CREDENTIAL)
            );
            byte[] secretBytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, secretBytes, 0, secretBytes.Length);
            return Encoding.Unicode.GetString(secretBytes);
        }
        finally
        {
            CredFree(credentialPtr);
        }
    }
}
"@

if ($request.action -eq "store") {
    [NeonForgeCredential]::Store(
        [string]$request.target,
        [string]$request.user,
        [string]$request.secret
    )
} elseif ($request.action -eq "read") {
    $secret = [NeonForgeCredential]::Read([string]$request.target)
    $secretBytes = [Text.Encoding]::UTF8.GetBytes($secret)
    [Console]::Out.Write([Convert]::ToBase64String($secretBytes))
} else {
    throw "Unsupported credential action: $($request.action)"
}
`;

const WINDOWS_CREDENTIAL_COMMAND = Buffer.from(
  WINDOWS_CREDENTIAL_SCRIPT,
  "utf16le"
).toString("base64");
