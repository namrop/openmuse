import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  browserWorkerUrl,
  optionalIntelligenceKey,
  shadowedEnvKeys,
} from "../apps/server/src/config.ts";

test("a missing or blank Intelligence key means local conversations", () => {
  for (const key of [undefined, "", " \t\n"]) assert.equal(optionalIntelligenceKey(key), undefined);
  assert.equal(
    optionalIntelligenceKey("  test-project-key-never-sent\n"),
    "test-project-key-never-sent",
  );
});

test("sample and live mode both start without an Intelligence key", async () => {
  const { readConfig } = await import("../apps/server/src/config.ts");
  const keys = [
    "WORKSPACE_MODE",
    "AGENT_BACKEND",
    "CPK_INTELLIGENCE_API_KEY",
    "OPENMUSE_ACCESS_KEY",
    "TOKEN_ENCRYPTION_KEY",
  ];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    delete process.env.CPK_INTELLIGENCE_API_KEY;
    delete process.env.AGENT_BACKEND;
    process.env.WORKSPACE_MODE = "sample";
    assert.equal(readConfig().intelligenceApiKey, undefined);
    process.env.WORKSPACE_MODE = "live";
    process.env.OPENMUSE_ACCESS_KEY = "fixture-access-key-of-24-plus-chars";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const live = readConfig();
    assert.equal(live.mode, "live");
    assert.equal(live.intelligenceApiKey, undefined);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the CopilotKit telemetry opt-out is set before the runtime module loads", () => {
  // A fresh process, as the server starts: the runtime reads the opt-out once, when its
  // module is evaluated, so the server's own import order decides whether it is off.
  const runtimeDir = dirname(
    createRequire(import.meta.url).resolve("@copilotkit/runtime/package.json"),
  );
  const client = pathToFileURL(join(runtimeDir, "dist/v2/runtime/telemetry/telemetry-client.mjs"));
  const app = pathToFileURL(fileURLToPath(new URL("../apps/server/src/app.ts", import.meta.url)));
  const env = { ...process.env };
  delete env.COPILOTKIT_TELEMETRY_DISABLED;
  delete env.DO_NOT_TRACK;
  const out = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(app.href)});` +
        `const t = (await import(${JSON.stringify(client.href)})).default;` +
        "console.log(JSON.stringify({ disabled: t.telemetryDisabled }));",
    ],
    { env, encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(out.trim().split("\n").at(-1) ?? ""), { disabled: true });
});

test("Jev mode is off by default and validates explicit modes", async () => {
  const { readConfig } = await import("../apps/server/src/config.ts");
  const old = {
    JEV_MODE: process.env.JEV_MODE,
    TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
    CPK_INTELLIGENCE_API_KEY: process.env.CPK_INTELLIGENCE_API_KEY,
  };
  try {
    process.env.CPK_INTELLIGENCE_API_KEY = "test-project-key-never-sent";
    delete process.env.JEV_MODE;
    assert.equal(readConfig().jevMode, "off");
    process.env.JEV_MODE = "sample";
    assert.equal(readConfig().jevMode, "sample");
    process.env.JEV_MODE = "live";
    delete process.env.TYPESAFE_API_KEY;
    assert.throws(() => readConfig(), /TYPESAFE_API_KEY/);
    process.env.TYPESAFE_API_KEY = "fixture-key";
    assert.equal(readConfig().typesafeApiKey, "fixture-key");
    process.env.JEV_MODE = "invalid";
    assert.throws(() => readConfig(), /JEV_MODE/);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("browser worker URL keeps an existing scheme and adds http to host:port", () => {
  assert.equal(browserWorkerUrl(undefined), undefined);
  assert.equal(browserWorkerUrl("  "), undefined);
  assert.equal(browserWorkerUrl("http://127.0.0.1:8790"), "http://127.0.0.1:8790");
  assert.equal(browserWorkerUrl("https://browser.internal:8790"), "https://browser.internal:8790");
  assert.equal(browserWorkerUrl("openmuse-browser-h4fx:8790"), "http://openmuse-browser-h4fx:8790");
});

test("environment variables that override a different .env value are reported by name", () => {
  const file = { OPENAI_API_KEY: "sk-or-file", MODEL: "openai/gpt-5", PORT: "8787", EMPTY: "" };
  const env = { OPENAI_API_KEY: "sk-proj-system", MODEL: "openai/gpt-5", EMPTY: "set" };
  assert.deepEqual(shadowedEnvKeys(file, env), ["OPENAI_API_KEY", "EMPTY"]);
  assert.deepEqual(shadowedEnvKeys(file, {}), []);
});
