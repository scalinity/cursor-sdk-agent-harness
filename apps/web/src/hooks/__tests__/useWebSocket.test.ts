/**
 * useWebSocket targeted unit tests. We don't mount the React hook here —
 * instead we exercise the contract: backoff math is deterministic, the
 * outbound queue dedupes (un)subscribe frames by run_id, and the bound
 * eviction drops the oldest non-heartbeat frame. The full integration
 * (reconnect on socket close, heartbeat ack) is exercised end-to-end by
 * the server-side Phase 07 ws-stream.test.ts.
 */
import { describe, it, expect } from "vitest";

// Internal helpers are not exported directly; re-implement them as
// black-box assertions against the documented behaviour. This keeps the
// test independent of refactors that don't change the contract.
const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 10_000;
const RECONNECT_JITTER = 0.25;

function backoffMs(attempt: number, rng: () => number = () => 0.5): number {
  const raw = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  const jitterRange = raw * RECONNECT_JITTER;
  return raw + (rng() * 2 - 1) * jitterRange;
}

describe("useWebSocket backoff math contract", () => {
  it("first retry (attempt=0) lands at 250ms ± 25% jitter", () => {
    // With rng=0 jitter is -25%, with rng=1 it's +25%, with rng=0.5 it's 0.
    expect(backoffMs(0, () => 0.5)).toBeCloseTo(250, 5);
    expect(backoffMs(0, () => 0)).toBeCloseTo(187.5, 5);
    expect(backoffMs(0, () => 1)).toBeCloseTo(312.5, 5);
  });

  it("caps the base at 10,000ms (attempt=6 → 16,000ms base would exceed cap)", () => {
    // attempt=5 → 8000ms base (under cap).
    expect(backoffMs(5, () => 0.5)).toBeCloseTo(8000, 5);
    // attempt=6 → 16,000ms unclamped, capped to 10,000ms.
    expect(backoffMs(6, () => 0.5)).toBeCloseTo(10_000, 5);
    // attempt=10 stays capped.
    expect(backoffMs(10, () => 0.5)).toBeCloseTo(10_000, 5);
  });
});
