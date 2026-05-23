/**
 * Phase 14 — client-side performance counters.
 *
 * Mirror of the server primitive (`apps/server/src/observability/perf-counters.ts`)
 * but with a different counter set. The two modules are intentionally not
 * shared via `packages/shared` because the runtime budget for the recorder
 * itself differs (browser RAF deadlines are stricter than Node setImmediate)
 * and we don't want the server to import a module just because the client
 * does.
 *
 * Counters:
 *   - `client_frame_validation_ms`: `serverFrameSchema.safeParse` wall time.
 *   - `client_event_ingest_ms`: `run-store.ingestServerFrame` wall time.
 *
 * The harness exposes `window.__harnessPerf` for `pnpm dev` introspection;
 * production builds keep that export, since it carries no sensitive data
 * (the histograms only count ms ranges).
 */

export type ClientCounterName =
  | "client_frame_validation_ms"
  | "client_event_ingest_ms";

export interface ClientCounterSnapshot {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

export interface ClientPerfCounters {
  observe(name: ClientCounterName, milliseconds: number): void;
  snapshot(name: ClientCounterName): ClientCounterSnapshot;
  snapshotAll(): Record<ClientCounterName, ClientCounterSnapshot>;
  reset(name?: ClientCounterName): void;
}

const COUNTER_NAMES: readonly ClientCounterName[] = [
  "client_frame_validation_ms",
  "client_event_ingest_ms",
] as const;

const DEFAULT_RING_SIZE = 1024;

interface RingState {
  buffer: Float64Array;
  filled: number;
  cursor: number;
}

function newRing(capacity: number): RingState {
  return { buffer: new Float64Array(capacity), filled: 0, cursor: 0 };
}

function ringObserve(ring: RingState, value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  ring.buffer[ring.cursor] = value;
  ring.cursor = (ring.cursor + 1) % ring.buffer.length;
  if (ring.filled < ring.buffer.length) ring.filled += 1;
}

function percentile(sorted: Float64Array, length: number, p: number): number {
  if (length === 0) return 0;
  const rank = Math.min(length - 1, Math.max(0, Math.ceil(p * length) - 1));
  return sorted[rank] ?? 0;
}

function ringSnapshot(ring: RingState): ClientCounterSnapshot {
  if (ring.filled === 0) {
    return { count: 0, p50: null, p95: null, p99: null, max: null };
  }
  const live = ring.buffer.slice(0, ring.filled);
  live.sort();
  return {
    count: ring.filled,
    p50: percentile(live, ring.filled, 0.5),
    p95: percentile(live, ring.filled, 0.95),
    p99: percentile(live, ring.filled, 0.99),
    max: live[ring.filled - 1] ?? null,
  };
}

export interface CreateClientPerfCountersOptions {
  ringSize?: number;
}

export function createClientPerfCounters(
  options: CreateClientPerfCountersOptions = {},
): ClientPerfCounters {
  const size = options.ringSize ?? DEFAULT_RING_SIZE;
  const rings: Record<ClientCounterName, RingState> = {
    client_frame_validation_ms: newRing(size),
    client_event_ingest_ms: newRing(size),
  };

  return {
    observe(name, ms) {
      ringObserve(rings[name], ms);
    },
    snapshot(name) {
      return ringSnapshot(rings[name]);
    },
    snapshotAll() {
      const out = {} as Record<ClientCounterName, ClientCounterSnapshot>;
      for (const name of COUNTER_NAMES) {
        out[name] = ringSnapshot(rings[name]);
      }
      return out;
    },
    reset(name) {
      if (name === undefined) {
        for (const n of COUNTER_NAMES) {
          rings[n] = newRing(size);
        }
        return;
      }
      rings[name] = newRing(size);
    },
  };
}

/**
 * Module-level singleton — used by `useWebSocket` (frame validation) and
 * `run-store` (event ingest). Reset between unit tests via `clientPerf.reset()`.
 */
export const clientPerf: ClientPerfCounters = createClientPerfCounters();

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
