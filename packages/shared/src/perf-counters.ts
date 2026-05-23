/**
 * Shared ring-buffer perf-counter primitive used by both `apps/server`
 * (Phase 14 `PerfCounters`) and `apps/web` (`ClientPerfCounters`).
 *
 * Why this lives in `packages/shared`: the two consumers were originally
 * duplicate-pasted (~70 lines of identical RingState + percentile +
 * snapshot logic). The dedupe lets one test suite exercise the primitive
 * for both sides while each consumer keeps its own `CounterName` union
 * and its own singleton.
 *
 * Each counter is a fixed-size ring buffer of millisecond samples.
 * p50/p95/p99 are computed on demand by sorting the live samples.
 * Observation is O(1); snapshot is O(n log n) over the buffered samples
 * (n ≤ ringSize, default 1024).
 *
 * Edge handling:
 *   - NaN, ±Infinity, and negative samples are dropped at `observe` time
 *     so a bad timer read (e.g. `performance.now()` drift) doesn't skew
 *     p99 silently.
 *   - The cursor wraps modulo `ringSize`; once filled, writes overwrite
 *     the oldest sample.
 *   - Percentiles use nearest-rank (`ceil(p * n) - 1`, clamped) — matches
 *     Pino-style histograms and avoids interpolation that misleads at
 *     small n.
 */

export interface CounterSnapshot {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

export interface PerfCountersAPI<TName extends string> {
  observe(name: TName, milliseconds: number): void;
  snapshot(name: TName): CounterSnapshot;
  snapshotAll(): Record<TName, CounterSnapshot>;
  reset(name?: TName): void;
}

export const DEFAULT_RING_SIZE = 1024;

interface RingState {
  buffer: Float64Array;
  /**
   * Number of valid samples currently in the buffer. Tracked separately
   * from cursor so snapshots don't include uninitialized zeros from a
   * half-full buffer.
   */
  filled: number;
  cursor: number;
  /**
   * P14-S6: cached snapshot, valid until the next `observe` invalidates
   * it. Avoids the O(n log n) sort + 8KB Float64Array allocation on
   * every read. Hot callers (a future watchdog that polls
   * /api/observability/perf at WS rates, or snapshotAll inside a tight
   * loop) get O(1) reads between writes; cold callers (the existing
   * stress test, periodic /usage page footer polls) see no behavior
   * change.
   */
  cachedSnapshot: CounterSnapshot | null;
}

function newRing(capacity: number): RingState {
  return {
    buffer: new Float64Array(capacity),
    filled: 0,
    cursor: 0,
    cachedSnapshot: null,
  };
}

function ringObserve(ring: RingState, value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  ring.buffer[ring.cursor] = value;
  ring.cursor = (ring.cursor + 1) % ring.buffer.length;
  if (ring.filled < ring.buffer.length) ring.filled += 1;
  // Invalidate the cached snapshot — the next snapshot() call will
  // recompute and re-cache.
  ring.cachedSnapshot = null;
}

function percentile(sorted: Float64Array, length: number, p: number): number {
  if (length === 0) return 0;
  const rank = Math.min(length - 1, Math.max(0, Math.ceil(p * length) - 1));
  return sorted[rank] ?? 0;
}

function ringSnapshot(ring: RingState): CounterSnapshot {
  // P14-S6: return cached snapshot when no observation has invalidated
  // it. The cache is invalidated by ringObserve on the next write.
  if (ring.cachedSnapshot !== null) return ring.cachedSnapshot;
  if (ring.filled === 0) {
    const empty: CounterSnapshot = {
      count: 0,
      p50: null,
      p95: null,
      p99: null,
      max: null,
    };
    ring.cachedSnapshot = empty;
    return empty;
  }
  // Float64Array.slice + sort sorts numerically — avoids the JS
  // Array.prototype.sort lexical-order pitfall.
  const live = ring.buffer.slice(0, ring.filled);
  live.sort();
  const snap: CounterSnapshot = {
    count: ring.filled,
    p50: percentile(live, ring.filled, 0.5),
    p95: percentile(live, ring.filled, 0.95),
    p99: percentile(live, ring.filled, 0.99),
    max: live[ring.filled - 1] ?? null,
  };
  ring.cachedSnapshot = snap;
  return snap;
}

export const EMPTY_SNAPSHOT: CounterSnapshot = {
  count: 0,
  p50: null,
  p95: null,
  p99: null,
  max: null,
} as const;

export interface CreatePerfCountersOptions {
  ringSize?: number;
}

/**
 * Build a `PerfCountersAPI<TName>` over a closed set of counter names.
 * Pass `names` as a readonly array of literal strings; the returned
 * recorder enforces that `observe(name, …)` only accepts those names
 * via the `TName` generic.
 *
 * The caller owns the counter-name union — each side (server / web) has
 * a different set, so the primitive can't hard-code one.
 */
export function createPerfCountersBase<TName extends string>(
  names: ReadonlyArray<TName>,
  options: CreatePerfCountersOptions = {},
): PerfCountersAPI<TName> {
  const size = options.ringSize ?? DEFAULT_RING_SIZE;
  const rings: Record<string, RingState> = {};
  for (const name of names) {
    rings[name] = newRing(size);
  }

  return {
    observe(name, ms) {
      const ring = rings[name];
      if (ring === undefined) return;
      ringObserve(ring, ms);
    },
    snapshot(name) {
      const ring = rings[name];
      return ring === undefined ? EMPTY_SNAPSHOT : ringSnapshot(ring);
    },
    snapshotAll() {
      const out = {} as Record<TName, CounterSnapshot>;
      for (const name of names) {
        const ring = rings[name];
        out[name] = ring === undefined ? EMPTY_SNAPSHOT : ringSnapshot(ring);
      }
      return out;
    },
    reset(name) {
      if (name === undefined) {
        for (const n of names) rings[n] = newRing(size);
        return;
      }
      if (rings[name] !== undefined) rings[name] = newRing(size);
    },
  };
}

/**
 * Build the do-nothing recorder for a given counter-name union. The
 * returned object is `Object.freeze`d so a caller that pulled this from
 * a barrel can't accidentally monkey-patch `observe` and corrupt every
 * default-bound consumer (the WS plugin and pipeline both use this as
 * their fallback).
 */
export function createNoopPerfCounters<TName extends string>(
  names: ReadonlyArray<TName>,
): PerfCountersAPI<TName> {
  return Object.freeze({
    observe(): void {},
    snapshot(): CounterSnapshot {
      return EMPTY_SNAPSHOT;
    },
    snapshotAll(): Record<TName, CounterSnapshot> {
      const out = {} as Record<TName, CounterSnapshot>;
      for (const name of names) out[name] = EMPTY_SNAPSHOT;
      return out;
    },
    reset(): void {},
  });
}
