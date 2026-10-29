import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  ProviderSecretInputError,
  providerSecretForAdd
} from "../apps/cli/src/provider-secret.ts";

test("provider add rejects secrets in process arguments", async () => {
  await assert.rejects(
    providerSecretForAdd(
      { options: { "api-key": "sk-argument-secret" }, flags: new Set() },
      stdinFrom("")
    ),
    (error: unknown) =>
      error instanceof ProviderSecretInputError &&
      /process arguments/.test(error.message)
  );
});

test("provider add reads keys from piped stdin", async () => {
  const secret = await providerSecretForAdd(
    { options: {}, flags: new Set(["api-key-stdin"]) },
    stdinFrom("sk-stdin-secret\n")
  );
  assert.equal(secret, "sk-stdin-secret");
});

test("provider add leaves environment credentials untouched", async () => {
  assert.equal(
    await providerSecretForAdd(
      { options: {}, flags: new Set() },
      stdinFrom("")
    ),
    undefined
  );
});

test("provider add rejects TTY and empty stdin", async () => {
  await assert.rejects(
    providerSecretForAdd(
      { options: {}, flags: new Set(["api-key-stdin"]) },
      Object.assign(stdinFrom(""), { isTTY: true })
    ),
    /requires piped input/
  );
  await assert.rejects(
    providerSecretForAdd(
      { options: {}, flags: new Set(["api-key-stdin"]) },
      stdinFrom("\n")
    ),
    /No API key/
  );
});

function stdinFrom(value: string): Readable {
  return Readable.from(value ? [value] : []);
}
