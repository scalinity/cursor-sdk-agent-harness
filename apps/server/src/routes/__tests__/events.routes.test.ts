import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { buildApp } from "../../app.js";
import { loadEnv } from "../../config/env.js";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories, type Repositories } from "../../db/repositories/index.js";
import { CursorApiKeyStore, CsrfSecretStore } from "../../keychain/index.js";
import {
  createInMemoryKeychainDriver,
  resetKeychainDriverForTests,
  setKeychainDriver,
} from "../../keychain/testing.js";
import { registerEventsRoutes } from "../events.routes.js";

const BASE_ENV = {
  HOST: "127.0.0.1",
  PORT: "4783",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  LOG_LEVEL: "error",
  KEYCHAIN_SERVICE: "cursor-sdk-agent-harness-test",
  ALLOW_REMOTE_BIND: "false",
};

function createEvent(repos: Repositories) {
  const agent = repos.agents.create({
    name: "Agent",
    status: "active",
    mode: "local",
    modelId: "composer-2-5-fast",
  });
  const run = repos.runs.create({ agentId: agent.id, status: "RUNNING" });
  return repos.events.appendCanonicalEvent({
    runId: run.id,
    agentId: agent.id,
    sdkType: "tool_call",
    kind: "tool_call.completed",
    payload: {
      call_id: "call-1",
      name: "read_file",
      status: "completed",
      args: { path: "src/file.ts" },
      result: { nested: { value: "loaded" } },
    },
    raw: { sdk: "raw" },
    occurredAt: new Date().toISOString(),
  });
}

describe("events routes", () => {
  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(() => {
    resetKeychainDriverForTests();
  });

  it("returns the stored payload JSON for an event id", async () => {
    const db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const agent = repos.agents.create({
      name: "Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const run = repos.runs.create({ agentId: agent.id, status: "RUNNING" });
    const event = repos.events.appendCanonicalEvent({
      runId: run.id,
      agentId: agent.id,
      sdkType: "tool_call",
      kind: "tool_call.completed",
      payload: { nested: { value: "loaded" } },
      occurredAt: new Date().toISOString(),
    });

    const app = Fastify({ logger: false });
    await registerEventsRoutes(app, { events: repos.events });

    const res = await app.inject({ method: "GET", url: `/api/events/${event.id}/payload` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ value: { nested: { value: "loaded" } } });

    await app.close();
    db.close();
  });

  it("404s for an unknown event id", async () => {
    const db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const app = Fastify({ logger: false });
    await registerEventsRoutes(app, { events: repos.events });

    const res = await app.inject({
      method: "GET",
      url: "/api/events/00000000-0000-0000-0000-000000000000/payload",
    });
    expect(res.statusCode).toBe(404);

    await app.close();
    db.close();
  });

  it("returns field-specific large payload JSON", async () => {
    const db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const event = createEvent(repos);
    const app = Fastify({ logger: false });
    await registerEventsRoutes(app, { events: repos.events });

    const res = await app.inject({ method: "GET", url: `/api/events/${event.id}/large-payload/result` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ value: { nested: { value: "loaded" } } });
    expect(res.json()).toHaveProperty("byteCount");

    await app.close();
    db.close();
  });

  it("serves large payloads through the full app security stack", async () => {
    const env = loadEnv(BASE_ENV);
    const db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const event = createEvent(repos);
    const built = await buildApp({
      env,
      repos,
      apiKeyStore: new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE }),
      csrfSecretStore: new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE }),
    });

    const res = await built.app.inject({
      method: "GET",
      url: `/api/events/${event.id}/large-payload/args`,
      headers: { origin: env.WEB_ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ value: { path: "src/file.ts" } });

    await built.app.close();
    db.close();
  });
});
