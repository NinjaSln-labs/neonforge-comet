export interface ProviderSecretArguments {
  options: Record<string, string>;
  flags: Set<string>;
}

export interface ProviderSecretStdin extends AsyncIterable<string | Buffer> {
  isTTY?: boolean;
}

export class ProviderSecretInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderSecretInputError";
  }
}

export async function providerSecretForAdd(
  args: ProviderSecretArguments,
  stdin: ProviderSecretStdin
): Promise<string | undefined> {
  if ("api-key" in args.options || args.flags.has("api-key")) {
    throw new ProviderSecretInputError(
      "--api-key is not supported because it exposes the secret in process arguments. Use --api-key-stdin with piped input, or set NEONFORGE_API_KEY/OPENAI_API_KEY."
    );
  }
  if (!args.flags.has("api-key-stdin")) return undefined;
  if (stdin.isTTY) {
    throw new ProviderSecretInputError(
      "--api-key-stdin requires piped input; interactive input is not supported."
    );
  }

  let value = "";
  for await (const chunk of stdin) value += String(chunk);
  const secret = value.replace(/[\r\n]+$/, "");
  if (!secret.trim()) {
    throw new ProviderSecretInputError("No API key was received on stdin.");
  }
  return secret;
}
