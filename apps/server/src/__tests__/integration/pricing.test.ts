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
import { applyPricingUpdate, getSettingsSnapshot } from "../../services/settings.service.js";

/**
 * Phase 14 — pricing settings validation tests per spec §11 Usage
 * Parse Failures. Covers:
 *   1. Negative per-million rates rejected (422).
 *   2. promoMultiplier outside [0, 1] rejected (422).
 *   3. `markVerified: true` sets `pricing.last_verified_at` to a UTC ISO timestamp.
 *   4. Staleness detection: `lastVerifiedAt` > 30 days old is flagged.
 *
 * The route is `PATCH /api/settings/pricing`. CSRF is required.
 */

const BASE_ENV: NodeJS.ProcessEnv = {
  HOST: "127.0.0.1",
  PORT: "4783",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  LOG_LEVEL: "error",
  KEYCHAIN_SERVICE: "cursor-sdk-agent-harness-pricing-test",
  ALLOW_REMOTE_BIND: "false",
};

interface Harness {
  app: FastifyInstance;
  close: () => Promise<void>;
  csrf: () => Promise<string>;
}

async function buildHarness(): Promise<Harness> {
  const env = loadEnv(BASE_ENV);
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
    csrf: async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/security/csrf-token",
        headers: { origin: "http://127.0.0.1:5173" },
      });
      return (res.json() as { token: string }).token;
    },
  };
}

describe("Phase 14 pricing settings validation", () => {
  let h: Harness;

  beforeEach(async () => {
    setKeychainDriver(createInMemoryKeychainDriver());
    h = await buildHarness();
  });
  afterEach(async () => {
    await h.close();
    resetKeychainDriverForTests();
  });

  it("rejects a negative input rate with VALIDATION_ERROR", async () => {
    const token = await h.csrf();
    const res = await h.app.inject({
      method: "PATCH",
      url: "/api/settings/pricing",
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
      payload: {
        composer25Fast: { inputPerMillionUsdMicros: -100 },
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  it("rejects promoMultiplier > 1 with VALIDATION_ERROR", async () => {
    const token = await h.csrf();
    const res = await h.app.inject({
      method: "PATCH",
      url: "/api/settings/pricing",
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
      payload: { promoMultiplier: 1.5 },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  it("rejects promoMultiplier < 0 with VALIDATION_ERROR", async () => {
    const token = await h.csrf();
    const res = await h.app.inject({
      method: "PATCH",
      url: "/api/settings/pricing",
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
      payload: { promoMultiplier: -0.1 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("markVerified: true stamps pricing.last_verified_at as UTC ISO now", async () => {
    const token = await h.csrf();
    const before = new Date();
    const res = await h.app.inject({
      method: "PATCH",
      url: "/api/settings/pricing",
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
      payload: { markVerified: true },
    });
    expect(res.statusCode).toBe(200);
    const after = new Date();
    const body = res.json() as {
      pricing: { lastVerifiedAt: string | null };
    };
    expect(body.pricing.lastVerifiedAt).toBeTruthy();
    const stamp = new Date(body.pricing.lastVerifiedAt!);
    // Should be within the request window.
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1_000);
    expect(stamp.getTime()).toBeLessThanOrEqual(after.getTime() + 1_000);
    // ISO format includes a "T" separator and a trailing Z (UTC).
    expect(body.pricing.lastVerifiedAt).toMatch(/T.*Z$/);
  });

  it("does NOT stamp lastVerifiedAt when markVerified is omitted (rate-only patch)", async () => {
    const token = await h.csrf();
    const res = await h.app.inject({
      method: "PATCH",
      url: "/api/settings/pricing",
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
      payload: {
        composer25Fast: { inputPerMillionUsdMicros: 2_000_000 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pricing: { lastVerifiedAt: string | null } };
    expect(body.pricing.lastVerifiedAt).toBeNull();
  });

});

// P14-S9: staleness check is a service-layer fixed-clock test — it
// doesn't need the Fastify harness the parent describe sets up. Lifted
// to its own describe so beforeEach/afterEach don't waste cycles
// building and tearing down a server for a test that touches only the
// settings service.
describe("Phase 14 pricing staleness (service-layer)", () => {
  it("a lastVerifiedAt > 30 days old can be detected from the snapshot", () => {
    const dbClient = openTestDb();
    const repos = createRepositories(dbClient.raw);
    try {
      const fakeNow = new Date("2026-04-01T00:00:00.000Z");
      applyPricingUpdate(repos.settings, { markVerified: true }, fakeNow);
      const snapshot = getSettingsSnapshot(repos.settings);
      expect(snapshot.pricing.lastVerifiedAt).toBe(fakeNow.toISOString());

      const checkAt = new Date("2026-05-05T00:00:00.000Z"); // 34 days later
      const last = new Date(snapshot.pricing.lastVerifiedAt!);
      const ageMs = checkAt.getTime() - last.getTime();
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      expect(ageDays).toBeGreaterThan(30);
    } finally {
      dbClient.raw.close();
    }
  });
});
