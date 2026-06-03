import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { loadEnv } from "../../config/env.js";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { CsrfSecretStore, CursorApiKeyStore } from "../../keychain/index.js";
import {
  createInMemoryKeychainDriver,
  resetKeychainDriverForTests,
  setKeychainDriver,
} from "../../keychain/testing.js";
import {
  COUNTER_NAMES,
  createPerfCounters,
  type PerfCounters,
} from "../../observability/perf-counters.js";

/**
 * P14-S3: integration test for `GET /api/observability/perf`.
 *
 * Asserts:
 *   1. 200 with the three server counter keys.
 *   2. `capturedAt` is a UTC ISO string.
 *   3. Origin policy still gates the route (cross-origin → 403).
 *   4. Injected counters reflect observations.
 *   5. CSRF is NOT required (GET routes are CSRF-exempt by Fastify
 *      convention — only mutating methods are gated).
 */

const BASE_ENV: NodeJS.ProcessEnv = {
  HOST: "127.0.0.1",
  PORT: "4783",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  LOG_LEVEL: "error",
  KEYCHAIN_SERVICE: "cursor-sdk-agent-harness-observability-test",
  ALLOW_REMOTE_BIND: "false",
};

interface Harness {
  app: FastifyInstance;
  perfCounters: PerfCounters;
  dbPath: string;
  repos: ReturnType<typeof createRepositories>;
  close: () => Promise<void>;
}

async function buildHarness(): Promise<Harness> {
  const env = loadEnv(BASE_ENV);
  const dbClient = openTestDb();
  const repos = createRepositories(dbClient.raw);
  const perfCounters = createPerfCounters({ ringSize: 64 });
  const { app } = await buildApp({
    env,
    repos,
    apiKeyStore: new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE }),
    csrfSecretStore: new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE }),
    perfCounters,
  });
  return {
    app,
    perfCounters,
    dbPath: env.DB_PATH,
    repos,
    close: async () => {
      await app.close();
      dbClient.raw.close();
    },
  };
}

describe("GET /api/observability/perf", () => {
  let h: Harness;

  beforeEach(async () => {
    setKeychainDriver(createInMemoryKeychainDriver());
    h = await buildHarness();
  });
  afterEach(async () => {
    await h.close();
    resetKeychainDriverForTests();
  });

  it("returns 200 with the three server counter keys and an ISO capturedAt", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/observability/perf",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      counters: Record<string, unknown>;
      capturedAt: string;
    };
    expect(Object.keys(body.counters).sort()).toEqual([...COUNTER_NAMES].sort());
    expect(body.capturedAt).toMatch(/T.*Z$/);
  });

  it("returns observed samples in the snapshot", async () => {
    h.perfCounters.observe("sdk_event_received_to_db_commit_ms", 1.5);
    h.perfCounters.observe("sdk_event_received_to_db_commit_ms", 2.5);
    h.perfCounters.observe("ws_flush_delay_ms", 0.4);

    const res = await h.app.inject({
      method: "GET",
      url: "/api/observability/perf",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      counters: Record<string, { count: number; p50: number | null }>;
    };
    expect(body.counters.sdk_event_received_to_db_commit_ms?.count).toBe(2);
    expect(body.counters.ws_flush_delay_ms?.count).toBe(1);
    expect(body.counters.db_commit_to_bus_publish_ms?.count).toBe(0);
  });

  it("rejects cross-origin requests with ORIGIN_FORBIDDEN", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/observability/perf",
      headers: { origin: "http://evil.example.com" },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code?: string }).code).toBe("ORIGIN_FORBIDDEN");
  });

  it("does NOT require an X-CSRF-Token (GET is CSRF-exempt)", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/observability/perf",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/observability/stats", () => {
  let h: Harness;

  beforeEach(async () => {
    setKeychainDriver(createInMemoryKeychainDriver());
    h = await buildHarness();
  });
  afterEach(async () => {
    await h.close();
    resetKeychainDriverForTests();
  });

  it("returns 200 with run/event counts, retention days, and capturedAt", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/observability/stats",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      runCount: number;
      eventCount: number;
      dbBytes: number | null;
      rawEventRetentionDays: number;
      capturedAt: string;
    };
    expect(body.runCount).toBeGreaterThanOrEqual(0);
    expect(body.eventCount).toBeGreaterThanOrEqual(0);
    expect(body.rawEventRetentionDays).toBeGreaterThanOrEqual(1);
    expect(body.capturedAt).toMatch(/T.*Z$/);
  });

  it("rejects cross-origin requests with ORIGIN_FORBIDDEN", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/observability/stats",
      headers: { origin: "http://evil.example.com" },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code?: string }).code).toBe("ORIGIN_FORBIDDEN");
  });
});
