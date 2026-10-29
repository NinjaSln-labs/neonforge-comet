# NeonForge

NeonForge is a local-first DeepSeek workbench. V1 Foundation provides a CLI TUI and a
headless NDJSON mode for delegated software and technical tasks.

## Requirements

- Node.js 22 or newer.
- A DeepSeek API key and provider endpoint.
- macOS, Linux, or Windows.

## Run

```bash
pnpm install
pnpm build
node dist/neonforge.mjs models list
```

Configure a provider:

```bash
export OPENAI_BASE_URL=https://api.deepseek.com
export OPENAI_API_KEY=...
export OPENAI_MODEL=deepseek-flash
node dist/neonforge.mjs provider add \
  --id deepseek --name DeepSeek --base-url https://api.deepseek.com \
  --model deepseek-flash --protocol openai-chat
```

To persist the key in the operating-system secret store, pipe it over stdin:

```bash
printf '%s' "$OPENAI_API_KEY" | node dist/neonforge.mjs provider add \
  --id deepseek --name DeepSeek --base-url https://api.deepseek.com \
  --model deepseek-flash --protocol openai-chat --api-key-stdin
```

`--api-key` is rejected because command-line arguments are visible to other processes.

Run a task:

```bash
node dist/neonforge.mjs run "Inspect the repository and summarize its structure" \
  --workspace . --permission balanced
```

Headless output:

```bash
node dist/neonforge.mjs run "Run the test suite" --workspace . --json
```

## Safety

NeonForge never bundles model weights. V1 supports only registered DeepSeek model names
and compatibility aliases. Provider credentials can come from the environment or the
operating-system secret store: macOS Keychain, Linux Secret Service (`secret-tool`), or
Windows Credential Manager. On Windows, secrets are passed to Credential Manager over
stdin and are not exposed in the PowerShell command line.

Useful commands:

```bash
node dist/neonforge.mjs provider list
node dist/neonforge.mjs provider test --id deepseek
node dist/neonforge.mjs session list
node dist/neonforge.mjs doctor
```

## WSL Magpie gateway

For a local WSL Magpie gateway, the development helper reads the existing Magpie caller
key without printing it and sets the OpenAI-compatible endpoint:

```bash
pnpm build
./scripts/dev/magpie-run.sh run "Reply with exactly OK" --workspace . --json
./scripts/dev/magpie-run.sh chat --workspace .
```

Environment overrides: `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY`, and
`MAGPIE_CALLER_KEYS`.

## License

NeonForge is released under the MIT License. See `LICENSE` and
`THIRD_PARTY_NOTICES`. Release installers contain both files.

Release evidence is rebuilt by native macOS, Linux, and Windows runners, assembled into
one source-bound bundle, and verified offline. See
`docs/release/evidence-reproduction.md` for the workflow, local commands, and provenance
verification procedure.
