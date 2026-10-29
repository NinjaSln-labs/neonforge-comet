import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "../packages/core/src/redact.ts";
import {
  createSecretStore,
  validateProvider
} from "../packages/config/src/index.ts";

test("redacts common credential forms", () => {
  const fakeApiKey = ["sk", "test", "placeholder"].join("-");
  const value = `Authorization: Bearer ${fakeApiKey} and api_key=supersecret token: abc`;
  const result = redact(value);
  assert.ok(!result.includes(fakeApiKey));
  assert.ok(!result.includes("supersecret"));
  assert.ok(!result.includes("token: abc"));
});

test("provider validation rejects insecure or credential-bearing URLs", () => {
  assert.throws(() =>
    validateProvider({
      id: "bad",
      name: "bad",
      baseUrl: "http://example.com",
      protocol: "openai-chat",
      model: "deepseek-flash"
    })
  );
  assert.throws(() =>
    validateProvider({
      id: "bad",
      name: "bad",
      baseUrl: "https://user:definitely-secret@example.com",
      protocol: "openai-chat",
      model: "deepseek-flash"
    })
  );
  assert.throws(() =>
    validateProvider({
      id: "bad",
      name: "bad",
      baseUrl: "https://example.com",
      protocol: "unknown" as never,
      model: "deepseek-flash"
    })
  );
});

test("Windows secret storage uses Credential Manager without exposing the secret in argv", () => {
  const credentialValue = "test-windows-credential";
  let invocation:
    | {
        file: string;
        args: string[];
        input?: string;
      }
    | undefined;
  const store = createSecretStore({
    platform: () => "win32",
    exec: (file, args, options) => {
      invocation = { file, args, input: options?.input ?? "" };
      return "";
    }
  });

  assert.equal(store.storeSecret("deepseek", credentialValue), "neonforge:deepseek");
  assert.equal(invocation?.file, "powershell.exe");
  const encodedScript = invocation?.args.at(-1) ?? "";
  assert.match(
    Buffer.from(encodedScript, "base64").toString("utf16le"),
    /CredWriteW/
  );
  assert.ok(invocation?.args.every((argument) => !argument.includes(credentialValue)));
  assert.deepEqual(JSON.parse(invocation?.input ?? "{}"), {
    action: "store",
    target: "neonforge:deepseek",
    user: "deepseek",
    secret: credentialValue
  });
});

test("Windows secret reads decode Credential Manager output", () => {
  const credentialValue = "test-windows-read";
  let input = "";
  const store = createSecretStore({
    platform: () => "win32",
    exec: (_file, _args, options) => {
      input = options?.input ?? "";
      return Buffer.from(credentialValue, "utf8").toString("base64");
    }
  });

  assert.equal(store.readSecret("neonforge:deepseek"), credentialValue);
  assert.deepEqual(JSON.parse(input), {
    action: "read",
    target: "neonforge:deepseek"
  });
});
