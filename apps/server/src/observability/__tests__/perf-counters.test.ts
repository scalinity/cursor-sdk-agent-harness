import { describe, expect, it } from "vitest";
import { createPerfCounters } from "../perf-counters.js";

describe("perf-counters", () => {
  it("returns empty snapshot before any observation", () => {
    const counters = createPerfCounters();
    const snap = counters.snapshot("sdk_event_received_to_db_commit_ms");
    expect(snap).toEqual({ count: 0, p50: null, p95: null, p99: null, max: null });
  });

  it("computes p50/p95/p99 over a uniform window", () => {
    const counters = createPerfCounters({ ringSize: 100 });
    for (let i = 1; i <= 100; i += 1) {
      counters.observe("sdk_event_received_to_db_commit_ms", i);
    }
    const snap = counters.snapshot("sdk_event_received_to_db_commit_ms");
    expect(snap.count).toBe(100);
    // nearest-rank: p50 = sample at index 49 (1-indexed: 50) = 50
    expect(snap.p50).toBe(50);
    expect(snap.p95).toBe(95);
    expect(snap.p99).toBe(99);
    expect(snap.max).toBe(100);
  });

  it("rolls samples once the ring is full", () => {
    const counters = createPerfCounters({ ringSize: 8 });
    // Push 16 samples — only the latest 8 (9..16) should remain.
    for (let i = 1; i <= 16; i += 1) {
      counters.observe("ws_flush_delay_ms", i);
    }
    const snap = counters.snapshot("ws_flush_delay_ms");
    expect(snap.count).toBe(8);
    expect(snap.max).toBe(16);
    expect(snap.p50).toBeGreaterThanOrEqual(9);
  });

  it("discards NaN and negative samples", () => {
    const counters = createPerfCounters();
    counters.observe("client_frame_validation_ms", Number.NaN);
    counters.observe("client_frame_validation_ms", -5);
    counters.observe("client_frame_validation_ms", 7);
    const snap = counters.snapshot("client_frame_validation_ms");
    expect(snap.count).toBe(1);
    expect(snap.p50).toBe(7);
  });

  it("snapshotAll returns one entry per known counter", () => {
    const counters = createPerfCounters();
    const all = counters.snapshotAll();
    expect(Object.keys(all).sort()).toEqual(
      [
        "client_event_ingest_ms",
        "client_frame_validation_ms",
        "db_commit_to_ws_broadcast_ms",
        "sdk_event_received_to_db_commit_ms",
        "ws_flush_delay_ms",
      ].sort(),
    );
  });

  it("reset clears one or all counters", () => {
    const counters = createPerfCounters();
    counters.observe("sdk_event_received_to_db_commit_ms", 10);
    counters.observe("ws_flush_delay_ms", 20);
    counters.reset("sdk_event_received_to_db_commit_ms");
    expect(counters.snapshot("sdk_event_received_to_db_commit_ms").count).toBe(0);
    expect(counters.snapshot("ws_flush_delay_ms").count).toBe(1);
    counters.reset();
    expect(counters.snapshot("ws_flush_delay_ms").count).toBe(0);
  });
});
