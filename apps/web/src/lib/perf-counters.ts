/**
 * Phase 14 — client-side performance counters.
 *
 * P14-S1: the ring-buffer + percentile + snapshot primitive now lives in
 * `@harness/shared`. This file owns only which counters the client
 * observes; the math and storage are dedup'd with the server side.
 *
 * Counters:
 *   - `client_frame_validation_ms`: `serverFrameSchema.safeParse` +
 *     `JSON.parse` wall time inside `useWebSocket`.
 *   - `client_event_ingest_ms`: `run-store.ingestServerFrame` wall time
 *     (only observed for frames that actually mutate state — P14-W3).
 *
 * The harness exposes `window.__harnessPerf` for `pnpm dev` introspection;
 * production builds keep that export, since it carries no sensitive data
 * (the histograms only count ms ranges).
 */
import {
  createNoopPerfCounters,
  createPerfCountersBase,
  type CounterSnapshot,
  type CreatePerfCountersOptions,
  type PerfCountersAPI,
} from "@harness/shared";

export type ClientCounterName =
  | "client_frame_validation_ms"
  | "client_event_ingest_ms";

export const CLIENT_COUNTER_NAMES: readonly ClientCounterName[] = [
  "client_frame_validation_ms",
  "client_event_ingest_ms",
] as const;

export type ClientPerfCounters = PerfCountersAPI<ClientCounterName>;
export type ClientCounterSnapshot = CounterSnapshot;

export function createClientPerfCounters(
  options: CreatePerfCountersOptions = {},
): ClientPerfCounters {
  return createPerfCountersBase<ClientCounterName>(CLIENT_COUNTER_NAMES, options);
}

/**
 * Module-level singleton — used by `useWebSocket` (frame validation) and
 * `run-store` (event ingest). Reset between unit tests via `clientPerf.reset()`.
 */
export const clientPerf: ClientPerfCounters = createClientPerfCounters();

/**
 * No-op client recorder for tests/library entry points that don't need
 * a real counter. Frozen by the shared factory so consumers can't
 * accidentally monkey-patch a method.
 */
export const NOOP_CLIENT_PERF_COUNTERS: ClientPerfCounters =
  createNoopPerfCounters<ClientCounterName>(CLIENT_COUNTER_NAMES);

/**
 * Expose a snapshot helper on `window` for ad-hoc debugging in `pnpm dev`.
 * The check guards against SSR/server-side rendering where `window` would
 * be undefined; tests run in jsdom which provides it.
 */
if (typeof window !== "undefined") {
  // Cast through `unknown` to avoid widening the global Window type with
  // a harness-specific field.
  (window as unknown as { __harnessPerf?: () => unknown }).__harnessPerf = () =>
    clientPerf.snapshotAll();
}
