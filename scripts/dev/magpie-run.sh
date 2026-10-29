#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEYS_FILE="${MAGPIE_CALLER_KEYS:-$HOME/.config/magpie/caller-keys.json}"

export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:3425/v1}"
export OPENAI_MODEL="${OPENAI_MODEL:-commandcode-plan/deepseek/deepseek-v4.1-flash}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-$(node -e 'const fs=require("fs");const p=process.argv[1];const keys=JSON.parse(fs.readFileSync(p,"utf8"));if(!keys[0]?.secret)process.exit(2);process.stdout.write(keys[0].secret)' "$KEYS_FILE")}"

exec node "$ROOT/dist/neonforge.mjs" "$@"
