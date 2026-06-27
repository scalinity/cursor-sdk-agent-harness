import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { SDKModel } from "../../sdk/sdk-adapter.js";
import { CursorModelCatalog } from "../cursor-model-catalog.js";

const API_KEY = "sk-test-secret-abcdef0123456789";

function sdkModel(overrides: Partial<SDKModel> = {}): SDKModel {
  return {
    id: "composer-2.5",
    displayName: "Composer 2.5",
    parameters: [
      {
        id: "thinking",
        displayName: "Thinking",
        values: [
          { value: "low", displayName: "Low" },
          { value: "high", displayName: "High" },
        ],
      },
    ],
    ...overrides,
  };
}

function captureLogger(): { logger: FastifyBaseLogger; warnings: unknown[][] } {
  const warnings: unknown[][] = [];
  const logger = {
    warn: (...args: unknown[]) => {
      warnings.push(args);
    },
    info: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
  } as unknown as FastifyBaseLogger;
  return { logger, warnings };
}

function makeClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("CursorModelCatalog", () => {
  it("reconciles SDK dotted ids to harness ids", async () => {
    const listModels = vi.fn(async () => [sdkModel()]);
    const { logger } = captureLogger();
    const catalog = new CursorModelCatalog({
      sdk: { listModels },
      apiKeyStore: { getApiKey: async () => API_KEY },
      logger,
    });
    const models = await catalog.list();
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("composer-2-5-fast");
    expect(models[0]?.parameters?.[0]?.id).toBe("thinking");
  });

  it("serves a fresh cache without re-fetching, and re-fetches after the TTL", async () => {
    const listModels = vi.fn(async () => [sdkModel()]);
    const clock = makeClock();
    const { logger } = captureLogger();
    const catalog = new CursorModelCatalog({
      sdk: { listModels },
      apiKeyStore: { getApiKey: async () => API_KEY },
      logger,
      ttlMs: 1000,
      now: clock.now,
    });
    await catalog.list();
    await catalog.list();
    expect(listModels).toHaveBeenCalledTimes(1);
    clock.advance(1001);
    await catalog.list();
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent refreshes into a single in-flight request", async () => {
    let resolve!: (v: SDKModel[]) => void;
    const listModels = vi.fn(
      () => new Promise<SDKModel[]>((r) => (resolve = r)),
    );
    const { logger } = captureLogger();
    const catalog = new CursorModelCatalog({
      sdk: { listModels },
      apiKeyStore: { getApiKey: async () => API_KEY },
      logger,
    });
    const a = catalog.list();
    const b = catalog.list();
    // listModels is only invoked after the getApiKey await resolves; wait for it
    // before resolving the in-flight request.
    await vi.waitFor(() => expect(listModels).toHaveBeenCalled());
    resolve([sdkModel()]);
    await Promise.all([a, b]);
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("returns [] without calling listModels when there is no API key", async () => {
    const listModels = vi.fn(async () => [sdkModel()]);
    const { logger } = captureLogger();
    const catalog = new CursorModelCatalog({
      sdk: { listModels },
      apiKeyStore: { getApiKey: async () => null },
      logger,
    });
    expect(await catalog.list()).toEqual([]);
    expect(listModels).not.toHaveBeenCalled();
  });

  it("falls back to the last good cache on error and logs without the api key", async () => {
    let fail = false;
    const listModels = vi.fn(async () => {
      if (fail) throw new Error("network down");
      return [sdkModel()];
    });
    const clock = makeClock();
    const { logger, warnings } = captureLogger();
    const catalog = new CursorModelCatalog({
      sdk: { listModels },
      apiKeyStore: { getApiKey: async () => API_KEY },
      logger,
      ttlMs: 1000,
      now: clock.now,
    });
    const first = await catalog.list();
    expect(first).toHaveLength(1);
    fail = true;
    clock.advance(1001);
    const second = await catalog.list();
    // stale cache served, not []
    expect(second).toEqual(first);
    expect(warnings.length).toBe(1);
    expect(JSON.stringify(warnings)).not.toContain(API_KEY);
  });

  it("negative-caches a no-key result so getApiKey isn't hit on every call", async () => {
    const getApiKey = vi.fn(async () => null);
    const listModels = vi.fn(async () => [sdkModel()]);
    const clock = makeClock();
    const { logger } = captureLogger();
    const catalog = new CursorModelCatalog({
      sdk: { listModels },
      apiKeyStore: { getApiKey },
      logger,
      negativeTtlMs: 1000,
      now: clock.now,
    });
    await catalog.list();
    await catalog.list();
    expect(getApiKey).toHaveBeenCalledTimes(1);
    // after the negative window, it retries
    clock.advance(1001);
    await catalog.list();
    expect(getApiKey).toHaveBeenCalledTimes(2);
  });

  it("clears the negative window after a successful refresh", async () => {
    let key: string | null = null;
    const getApiKey = vi.fn(async () => key);
    const listModels = vi.fn(async () => [sdkModel()]);
    const clock = makeClock();
    const { logger } = captureLogger();
    const catalog = new CursorModelCatalog({
      sdk: { listModels },
      apiKeyStore: { getApiKey },
      logger,
      ttlMs: 1000,
      negativeTtlMs: 1000,
      now: clock.now,
    });
    expect(await catalog.list()).toEqual([]); // no key → negative cached
    key = API_KEY;
    clock.advance(1001); // negative window expires
    expect(await catalog.list()).toHaveLength(1); // success populates positive cache
    expect(await catalog.list()).toHaveLength(1); // served from positive cache
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});
