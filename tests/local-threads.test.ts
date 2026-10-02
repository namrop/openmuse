import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createApp } from "../apps/server/src/app.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

// No intelligenceApiKey: the conversation stays in OpenMuse's own database and
// nothing is sent to a CopilotKit Intelligence project.
let db: Store, directory: string, token: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-local-threads-"));
  db = await createStore();
  ({ app } = await createApp(db, {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  }));
  const session = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  token = (await session.json()).token;
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("without an Intelligence key the workspace reports local conversations", async () => {
  const body = await (await app.request("/api/workspace", { headers: headers() })).json();
  assert.equal(body.runtime.richThreads, false);
});

test("the main conversation id is local and never touches Intelligence", async (t) => {
  const calls = t.mock.method(CopilotKitIntelligence.prototype, "getOrCreateThread", async () => {
    throw new Error("Intelligence must not be called without a key");
  });
  const response = await app.request("/api/main-thread", { headers: headers() });
  assert.equal(response.status, 200);
  const main = await response.json();
  assert.equal(main.existing, false);
  assert.equal(typeof main.threadId, "string");
  assert.equal(calls.mock.callCount(), 0);
});

test("the conversation is saved in OpenMuse's database and reloads", async () => {
  const messages = [
    { id: "local-user-1", role: "user", content: "Show my calendar" },
    { id: "local-assistant-1", role: "assistant", content: "Here is your week." },
  ];
  const saved = await app.request("/api/conversation", {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ messages }),
  });
  assert.equal(saved.status, 200);
  const reloaded = await (await app.request("/api/conversation", { headers: headers() })).json();
  assert.deepEqual(reloaded.messages, messages);
});

test("the CopilotKit runtime streams a sample run without Intelligence", async () => {
  const info = await app.request("/api/copilotkit/info", { headers: headers() });
  assert.equal(info.status, 200);
  const response = await app.request("/api/copilotkit/agent/default/run", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      threadId: "local-main",
      runId: "local-run",
      messages: [{ id: "local-message", role: "user", content: "Show my calendar" }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    }),
  });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /RUN_STARTED/);
  assert.match(stream, /TEXT_MESSAGE_CONTENT/);
  assert.match(stream, /RUN_FINISHED/);
});
