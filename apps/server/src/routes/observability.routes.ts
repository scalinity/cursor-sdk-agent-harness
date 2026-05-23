import type { FastifyInstance } from "fastify";
import type { PerfCounters } from "../observability/perf-counters.js";

export interface ObservabilityRoutesDeps {
  perfCounters: PerfCounters;
}

/**
 * Phase 14 — surface live perf-counter snapshots through HTTP for the
 * `/usage` page footer, local diagnostics, and stress fixtures. Keep
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
    return {
      counters: deps.perfCounters.snapshotAll(),
      capturedAt: new Date().toISOString(),
    };
  });
}
