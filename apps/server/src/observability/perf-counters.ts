/**
 * Phase 14 — server-side performance counters.
 *
 * Wraps the shared ring-buffer primitive from `@harness/shared` with the
 * server's `CounterName` union. The shared module owns the math and
 * storage; this file owns which counters the server observes.
 *
 * P14-S1: ring-buffer + percentile + snapshot logic was previously
 * duplicate-pasted between this file and `apps/web/src/lib/perf-counters.ts`.
 * Both now import from `@harness/shared` so the primitive has one home
 * and one test suite.
 *
 * P14-S8: server-side counters only. The `client_*` counters live in
 * `apps/web/src/lib/perf-counters.ts` because the server never observes
 * them — having dead options on the server union confused readers and
 * exposed always-empty rows via `/api/observability/perf`.
 *
 * P14-W4: `db_commit_to_bus_publish_ms` (renamed from
 * `db_commit_to_ws_broadcast_ms`) measures the synchronous in-process
 * `RunBus.publish` call, not the actual socket write. The real WS flush
 * delay is `ws_flush_delay_ms`, observed inside `deliverEvent`. Naming
 * is honest now so spec §13 budget enforcement isn't fooled.
 *
 * P14-S4 + S7: `NOOP_PERF_COUNTERS` is frozen at construction (via the
 * shared factory) so a caller can't monkey-patch a method, and its
 * `snapshotAll` is built from `COUNTER_NAMES` so adding a counter only
 * touches the union and the const.
 */
import {
  createNoopPerfCounters,
  createPerfCountersBase,
  type CounterSnapshot,
  type CreatePerfCountersOptions,
  type PerfCountersAPI,
} from "@harness/shared";

export type CounterName =
  | "sdk_event_received_to_db_commit_ms"
  | "db_commit_to_bus_publish_ms"
  | "ws_flush_delay_ms";

export const COUNTER_NAMES: readonly CounterName[] = [
  "sdk_event_received_to_db_commit_ms",
  "db_commit_to_bus_publish_ms",
  "ws_flush_delay_ms",
] as const;

export type PerfCounters = PerfCountersAPI<CounterName>;
export type { CounterSnapshot };

export function createPerfCounters(
  options: CreatePerfCountersOptions = {},
): PerfCounters {
  return createPerfCountersBase<CounterName>(COUNTER_NAMES, options);
}

/**
 * No-op recorder for code paths that don't need a real counter (tests,
 * library entry points, default-bound fallbacks). Frozen by the shared
 * factory so a caller can't accidentally monkey-patch a method.
 */
export const NOOP_PERF_COUNTERS: PerfCounters =
  createNoopPerfCounters<CounterName>(COUNTER_NAMES);
