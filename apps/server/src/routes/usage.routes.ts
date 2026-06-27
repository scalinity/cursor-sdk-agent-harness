import {
  PRICING_SETTING_KEYS,
  usageBreakdownResponseSchema,
  usageDailyResponseSchema,
  usageDateRangeQuerySchema,
  usageSummaryResponseSchema,
  type PricingFreshness,
} from "@harness/shared";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import type { RunsRepo, UsageRangeOptions, UsageSummaryAggregate } from "../db/repositories/runs.repo.js";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import { send422 } from "./route-errors.js";

export interface UsageRoutesDeps {
  runsRepo: RunsRepo;
  settingsRepo: SettingsRepo;
}

const CACHE_TTL_MS = 60_000;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

function freshnessFromLastVerified(lastVerifiedAt: string | null, now = new Date()): PricingFreshness {
  if (lastVerifiedAt === null) {
    return { lastVerifiedAt: null, staleness: "never_verified" };
  }
  const parsed = Date.parse(lastVerifiedAt);
  if (!Number.isFinite(parsed)) {
    return { lastVerifiedAt, staleness: "stale" };
  }
  const ageMs = now.getTime() - parsed;
  return {
    lastVerifiedAt,
    staleness: ageMs > 30 * 24 * 60 * 60 * 1000 ? "stale" : "fresh",
  };
}

function getCached(cache: Map<string, CacheEntry>, key: string): unknown | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached(cache: Map<string, CacheEntry>, key: string, value: unknown): unknown {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function toRangeOptions(query: z.infer<typeof usageDateRangeQuerySchema>): UsageRangeOptions {
  const out: UsageRangeOptions = {};
  if (query.from !== undefined) out.from = query.from;
  if (query.to !== undefined) out.to = query.to;
  if (query.agentId !== undefined) out.agentId = query.agentId;
  if (query.modelId !== undefined) out.modelId = query.modelId;
  return out;
}

export async function registerUsageRoutes(app: FastifyInstance, deps: UsageRoutesDeps): Promise<void> {
  const cache = new Map<string, CacheEntry>();

  app.get("/api/usage/summary", async (req, reply) => {
    const parsed = usageDateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return send422(reply, parsed.error);
    const key = req.url;
    const cached = getCached(cache, key) as UsageSummaryAggregate | undefined;
    const summary = cached ?? setCached(cache, key, deps.runsRepo.usageSummary(toRangeOptions(parsed.data))) as UsageSummaryAggregate;
    const lastVerifiedAt = deps.settingsRepo.get<string | null>(
      PRICING_SETTING_KEYS.lastVerifiedAt,
    ) ?? null;
    return usageSummaryResponseSchema.parse({
      ...summary,
      pricingFreshness: freshnessFromLastVerified(lastVerifiedAt),
    });
  });

  app.get("/api/usage/daily", async (req, reply) => {
    const parsed = usageDateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return send422(reply, parsed.error);
    const key = req.url;
    const cached = getCached(cache, key);
    if (cached !== undefined) return cached;
    return setCached(
      cache,
      key,
      usageDailyResponseSchema.parse(deps.runsRepo.usageDaily(toRangeOptions(parsed.data))),
    );
  });

  app.get("/api/usage/by-model", async (req, reply) => {
    const parsed = usageDateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return send422(reply, parsed.error);
    const key = req.url;
    const cached = getCached(cache, key);
    if (cached !== undefined) return cached;
    return setCached(
      cache,
      key,
      usageBreakdownResponseSchema.parse({
        items: deps.runsRepo.usageByModel(toRangeOptions(parsed.data)),
      }),
    );
  });

  app.get("/api/usage/by-agent", async (req, reply) => {
    const parsed = usageDateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return send422(reply, parsed.error);
    const key = req.url;
    const cached = getCached(cache, key);
    if (cached !== undefined) return cached;
    return setCached(
      cache,
      key,
      usageBreakdownResponseSchema.parse({
        items: deps.runsRepo.usageByAgent(toRangeOptions(parsed.data)),
      }),
    );
  });
}
