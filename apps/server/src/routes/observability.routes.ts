import type { FastifyInstance } from "fastify";
import {
  observabilityPerfResponseSchema,
  observabilityStatsResponseSchema,
} from "@harness/shared";
import type { PerfCounters } from "../observability/perf-counters.js";
import { queryObservabilityStats, type ObservabilityStatsDeps } from "../observability/stats.js";

export interface ObservabilityRoutesDeps {
  perfCounters: PerfCounters;
  stats: ObservabilityStatsDeps;
}

/**
 * Phase 14 — surface live perf-counter snapshots through HTTP for the
 * Observatory page, local diagnostics, and stress fixtures. Keep
 * the payload tiny (one object per counter) so the route itself stays
 * inside the spec §13 measurement budget.
 *
 * The route is loopback-only by virtue of the server's bind policy and
 * already-registered Origin / CSRF gates; no extra access controls are
 * needed here.
 */
export async function registerObservabilityRoutes(
  app: FastifyInstance,
  deps: ObservabilityRoutesDeps,
): Promise<void> {
  app.get("/api/observability/perf", async () => {
    const body = {
      counters: deps.perfCounters.snapshotAll(),
      capturedAt: new Date().toISOString(),
    };
    return observabilityPerfResponseSchema.parse(body);
  });

  app.get("/api/observability/stats", async () => {
    return observabilityStatsResponseSchema.parse(queryObservabilityStats(deps.stats));
  });
}
