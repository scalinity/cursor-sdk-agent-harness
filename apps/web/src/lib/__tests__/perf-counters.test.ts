import { describe, expect, it } from "vitest";
import {
  CLIENT_COUNTER_NAMES,
  NOOP_CLIENT_PERF_COUNTERS,
  createClientPerfCounters,
} from "../perf-counters.js";

/**
 * P14-S2: client-side mirror of the server perf-counter unit tests.
 * The math lives in `@harness/shared` and is exercised on both sides;
 * this suite asserts the client-specific bindings — counter-name union,
 * NaN/negative rejection, ring-wrap behaviour, snapshotAll shape, and
 * reset semantics — so a future client-only refactor would have a guard.
 */

describe("client perf-counters", () => {
  it("returns empty snapshot before any observation", () => {
    const counters = createClientPerfCounters();
    expect(counters.snapshot("client_frame_validation_ms")).toEqual({
      count: 0,
      p50: null,
      p95: null,
      p99: null,
      max: null,
    });
  });

  it("computes p50/p95/p99 over a uniform window", () => {
    const counters = createClientPerfCounters({ ringSize: 100 });
    for (let i = 1; i <= 100; i += 1) {
      counters.observe("client_event_ingest_ms", i);
    }
    const snap = counters.snapshot("client_event_ingest_ms");
    expect(snap.count).toBe(100);
    // nearest-rank: p50 = ceil(0.5 * 100) - 1 = index 49 = sample 50
    expect(snap.p50).toBe(50);
    expect(snap.p95).toBe(95);
    expect(snap.p99).toBe(99);
    expect(snap.max).toBe(100);
  });

  it("rolls samples once the ring is full", () => {
    const counters = createClientPerfCounters({ ringSize: 8 });
    for (let i = 1; i <= 16; i += 1) {
      counters.observe("client_frame_validation_ms", i);
    }
    const snap = counters.snapshot("client_frame_validation_ms");
    expect(snap.count).toBe(8);
    expect(snap.max).toBe(16);
    expect(snap.p50).toBeGreaterThanOrEqual(9);
  });

  it("discards NaN and negative samples", () => {
    const counters = createClientPerfCounters();
    counters.observe("client_frame_validation_ms", Number.NaN);
    counters.observe("client_frame_validation_ms", -5);
    counters.observe("client_frame_validation_ms", 7);
    const snap = counters.snapshot("client_frame_validation_ms");
    expect(snap.count).toBe(1);
    expect(snap.p50).toBe(7);
  });

  it("snapshotAll returns exactly the two client counter keys", () => {
    const counters = createClientPerfCounters();
    const all = counters.snapshotAll();
    expect(Object.keys(all).sort()).toEqual(
      ["client_event_ingest_ms", "client_frame_validation_ms"].sort(),
    );
  });

  it("reset() clears one or all counters", () => {
    const counters = createClientPerfCounters();
    counters.observe("client_frame_validation_ms", 10);
    counters.observe("client_event_ingest_ms", 20);
    counters.reset("client_frame_validation_ms");
    expect(counters.snapshot("client_frame_validation_ms").count).toBe(0);
    expect(counters.snapshot("client_event_ingest_ms").count).toBe(1);
    counters.reset();
    expect(counters.snapshot("client_event_ingest_ms").count).toBe(0);
  });

  it("NOOP_CLIENT_PERF_COUNTERS is frozen and never records", () => {
    NOOP_CLIENT_PERF_COUNTERS.observe("client_frame_validation_ms", 999);
    expect(NOOP_CLIENT_PERF_COUNTERS.snapshot("client_frame_validation_ms").count).toBe(0);
    // P14-S4: monkey-patching the no-op is rejected by Object.freeze.
    expect(() => {
      (NOOP_CLIENT_PERF_COUNTERS as unknown as { observe: () => void }).observe = () => {};
    }).toThrow();
  });

  it("CLIENT_COUNTER_NAMES matches the union", () => {
    expect(CLIENT_COUNTER_NAMES).toEqual([
      "client_frame_validation_ms",
      "client_event_ingest_ms",
    ]);
  });
});
