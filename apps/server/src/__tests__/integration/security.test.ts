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

const BASE_ENV: NodeJS.ProcessEnv = {
  HOST: "127.0.0.1",
  PORT: "4783",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  LOG_LEVEL: "error",
  KEYCHAIN_SERVICE: "cursor-sdk-agent-harness-test",
  ALLOW_REMOTE_BIND: "false",
};

interface BuiltHarness {
  app: FastifyInstance;
  close: () => Promise<void>;
}

async function buildHarness(envOverrides: NodeJS.ProcessEnv = {}): Promise<BuiltHarness> {
  const env = loadEnv({ ...BASE_ENV, ...envOverrides });
  const dbClient = openTestDb();
  const repos = createRepositories(dbClient.raw);
  const { app } = await buildApp({
    env,
    repos,
    apiKeyStore: new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE }),
    csrfSecretStore: new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE }),
  });
  return {
    app,
    close: async () => {
      await app.close();
      dbClient.raw.close();
    },
  };
}

async function csrfToken(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: "/api/security/csrf-token",
    headers: { origin: "http://127.0.0.1:5173" },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

describe("security perimeter", () => {
  let h: BuiltHarness;

  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(async () => {
    await h?.close();
    resetKeychainDriverForTests();
  });

  describe("origin policy", () => {
    it("allows requests with the configured origin", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "GET",
        url: "/api/health/live",
        headers: { origin: "http://127.0.0.1:5173" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("rejects requests from a different origin with ORIGIN_FORBIDDEN", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "GET",
        url: "/api/health/live",
        headers: { origin: "http://evil.example.com" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: "ORIGIN_FORBIDDEN" });
    });

    it("rejects the app://harness origin when not in desktop mode", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "GET",
        url: "/api/health/live",
        headers: { origin: "app://harness" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: "ORIGIN_FORBIDDEN" });
    });

    // Regression: the packaged renderer loads from app://harness and calls the
    // embedded server cross-origin. desktopMode must be read from the parsed
    // env (HARNESS_DESKTOP flows through startServer's envOverrides → loadEnv),
    // NOT process.env — otherwise the allowlist never includes app://harness
    // and every renderer request 403s (blank/non-functional desktop app).
    it("allows the app://harness origin in desktop mode (HARNESS_DESKTOP=1)", async () => {
      h = await buildHarness({ HARNESS_DESKTOP: "1" });
      const res = await h.app.inject({
        method: "GET",
        url: "/api/health/live",
        headers: { origin: "app://harness" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("allows safe methods with no Origin (curl)", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "GET",
        url: "/api/health/live",
      });
      expect(res.statusCode).toBe(200);
    });

    it("rejects safe requests with no Origin from non-loopback clients", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "GET",
        url: "/api/health/live",
        remoteAddress: "203.0.113.10",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: "ORIGIN_MISSING" });
    });

    it("rejects mutating requests with no Origin even from loopback", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "PATCH",
        url: "/api/settings",
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: "ORIGIN_MISSING" });
    });

    it("rejects an OPTIONS preflight with a foreign Origin", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "OPTIONS",
        url: "/api/settings",
        headers: {
          origin: "http://evil.example.com",
          "access-control-request-method": "PATCH",
          "access-control-request-headers": "x-csrf-token,content-type",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: "ORIGIN_FORBIDDEN" });
    });
  });

  describe("CSRF", () => {
    it("rejects PATCH /api/settings without an X-CSRF-Token", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "PATCH",
        url: "/api/settings",
        payload: {},
        headers: { origin: "http://127.0.0.1:5173" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: "CSRF_FAILED" });
    });

    it("rejects PATCH /api/settings with an invalid X-CSRF-Token", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "PATCH",
        url: "/api/settings",
        payload: {},
        headers: {
          origin: "http://127.0.0.1:5173",
          "x-csrf-token": "not.a.real.token",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: "CSRF_FAILED" });
    });

    it("accepts PATCH /api/settings with a valid token", async () => {
      h = await buildHarness();
      const token = await csrfToken(h.app);
      const res = await h.app.inject({
        method: "PATCH",
        url: "/api/settings",
        payload: { rawEventRetentionDays: 90 },
        headers: {
          origin: "http://127.0.0.1:5173",
          "x-csrf-token": token,
          "content-type": "application/json",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ rawEventRetentionDays: 90 });
    });
  });

  describe("API key roundtrip", () => {
    it("starts absent, accepts PUT, then GET reports present, then DELETE", async () => {
      h = await buildHarness();
      const token = await csrfToken(h.app);
      const headers = {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      };

      const before = await h.app.inject({
        method: "GET",
        url: "/api/settings/api-key",
        headers: { origin: "http://127.0.0.1:5173" },
      });
      expect(before.json()).toEqual({ present: false });

      const put = await h.app.inject({
        method: "PUT",
        url: "/api/settings/api-key",
        payload: { value: "sk-test-XXXXXXXX" },
        headers,
      });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual({ present: true });

      const after = await h.app.inject({
        method: "GET",
        url: "/api/settings/api-key",
        headers: { origin: "http://127.0.0.1:5173" },
      });
      expect(after.json()).toEqual({ present: true });

      const del = await h.app.inject({
        method: "DELETE",
        url: "/api/settings/api-key",
        headers: {
          origin: "http://127.0.0.1:5173",
          "x-csrf-token": token,
        },
      });
      expect(del.statusCode).toBe(200);
      expect(del.json()).toEqual({ present: false });
    });

    it("rejects an unreasonably short API key value", async () => {
      h = await buildHarness();
      const token = await csrfToken(h.app);
      const res = await h.app.inject({
        method: "PUT",
        url: "/api/settings/api-key",
        payload: { value: "short" },
        headers: {
          origin: "http://127.0.0.1:5173",
          "x-csrf-token": token,
          "content-type": "application/json",
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });

  describe("workspace allowlist validate", () => {
    it("returns missing for a nonexistent path", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "POST",
        url: "/api/workspace-allowlist/validate",
        payload: { path: "/this/path/does/not/exist/at/all" },
        headers: {
          origin: "http://127.0.0.1:5173",
          "x-csrf-token": await csrfToken(h.app),
          "content-type": "application/json",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ allowed: false, reason: "missing" });
    });
  });

  describe("settings snapshot", () => {
    it("GET /api/settings returns the seeded defaults", async () => {
      h = await buildHarness();
      const res = await h.app.inject({
        method: "GET",
        url: "/api/settings",
        headers: { origin: "http://127.0.0.1:5173" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.defaultModelId).toBe("composer-2-5-fast");
      expect(body.sandboxEnabledByDefault).toBe(true);
      expect(body.rawEventRetentionDays).toBe(180);
      expect(body).toHaveProperty("pricing");
    });
  });
});
