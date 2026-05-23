/**
 * Phase 14 — lightweight performance counters.
 *
 * Each counter is a fixed-size ring buffer of millisecond samples. p50/p95/p99
 * are computed on demand by sorting the buffer's live samples. The measurement
 * overhead is bounded:
 *
 *   - `observe(name, ms)`     O(1) — write into the ring at the cursor.
 *   - `snapshot(name)`        O(n log n) over the buffered samples (n ≤ 1024).
 *
 * Memory: one number per slot per counter. With the spec default (1024 slots,
 * 5 named counters) the resident footprint is ~40KB — small enough that the
 * "budget for measurement itself" target (<0.1ms per event) is comfortably
 * met. The host process is single-threaded so no synchronisation is needed.
 *
 * Why a custom ring instead of an existing histogram lib:
 *   - No npm dep on the hot path.
 *   - Snapshots return real p99 over the rolling window, not exponentially
 *     decayed estimators, which makes acceptance gates straightforward to
 *     assert (`p95 < 25ms`) without statistical fudge.
 *
 * The counter names are spec §13 metric labels translated to snake_case.
 */

export type CounterName =
  | "sdk_event_received_to_db_commit_ms"
  | "db_commit_to_ws_broadcast_ms"
  | "ws_flush_delay_ms"
  | "client_frame_validation_ms"
  | "client_event_ingest_ms";

export interface CounterSnapshot {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

export interface PerfCounters {
  observe(name: CounterName, milliseconds: number): void;
  snapshot(name: CounterName): CounterSnapshot;
  snapshotAll(): Record<CounterName, CounterSnapshot>;
  reset(name?: CounterName): void;
}

const DEFAULT_RING_SIZE = 1024;

const COUNTER_NAMES: readonly CounterName[] = [
  "sdk_event_received_to_db_commit_ms",
  "db_commit_to_ws_broadcast_ms",
  "ws_flush_delay_ms",
  "client_frame_validation_ms",
  "client_event_ingest_ms",
] as const;

interface RingState {
  buffer: Float64Array;
  // `filled` is the number of valid samples currently in the buffer.
  // Once it reaches `capacity` the buffer is full and writes overwrite
  // the oldest sample. Tracked separately from cursor so snapshots
  // don't include uninitialized zeros from a half-full buffer.
  filled: number;
  cursor: number;
}

function newRing(capacity: number): RingState {
  return { buffer: new Float64Array(capacity), filled: 0, cursor: 0 };
}

function ringObserve(ring: RingState, value: number): void {
  // Discard non-finite samples — bad timer reads (NaN / negative drift from
  // performance.now() resets) would skew p99 silently.
  if (!Number.isFinite(value) || value < 0) return;
  ring.buffer[ring.cursor] = value;
  ring.cursor = (ring.cursor + 1) % ring.buffer.length;
  if (ring.filled < ring.buffer.length) ring.filled += 1;
}

function percentile(sorted: Float64Array, length: number, p: number): number {
  if (length === 0) return 0;
  // Standard nearest-rank: ceil(p * n) - 1, clamped. Matches the
  // conventions used by Pino's pretty-printer and most observability
  // libs; avoids interpolation that would be misleading when n is small.
  const rank = Math.min(length - 1, Math.max(0, Math.ceil(p * length) - 1));
  return sorted[rank] ?? 0;
}

function ringSnapshot(ring: RingState): CounterSnapshot {
  if (ring.filled === 0) {
    return { count: 0, p50: null, p95: null, p99: null, max: null };
  }
  // Sort only the live portion of the buffer. For a 1024-slot ring this
  // is well under a millisecond even on a cold path.
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

export interface CreatePerfCountersOptions {
  ringSize?: number;
}

export function createPerfCounters(
  options: CreatePerfCountersOptions = {},
): PerfCounters {
  const size = options.ringSize ?? DEFAULT_RING_SIZE;
  const rings: Record<CounterName, RingState> = {
    sdk_event_received_to_db_commit_ms: newRing(size),
    db_commit_to_ws_broadcast_ms: newRing(size),
    ws_flush_delay_ms: newRing(size),
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
      const out = {} as Record<CounterName, CounterSnapshot>;
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
 * A do-nothing counter — used in code paths (tests, library entry points)
 * that don't need to wire a real counter. Keeps the production seam type-safe
 * without leaking `null` checks into every observation site.
 */
export const NOOP_PERF_COUNTERS: PerfCounters = {
  observe() {},
  snapshot() {
    return { count: 0, p50: null, p95: null, p99: null, max: null };
  },
  snapshotAll() {
    return {
      sdk_event_received_to_db_commit_ms: { count: 0, p50: null, p95: null, p99: null, max: null },
      db_commit_to_ws_broadcast_ms: { count: 0, p50: null, p95: null, p99: null, max: null },
      ws_flush_delay_ms: { count: 0, p50: null, p95: null, p99: null, max: null },
      client_frame_validation_ms: { count: 0, p50: null, p95: null, p99: null, max: null },
      client_event_ingest_ms: { count: 0, p50: null, p95: null, p99: null, max: null },
    };
  },
  reset() {},
};
