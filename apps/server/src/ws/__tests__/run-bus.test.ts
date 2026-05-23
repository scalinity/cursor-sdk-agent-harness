import { describe, expect, it, vi } from "vitest";
import type { EventRow } from "@harness/shared";
import { createRunBus } from "../run-bus.js";

function fakeEvent(runId: string, seq: number): EventRow {
  return {
    id: `evt-${seq}`,
    runId,
    agentId: "agent-1",
    seq,
    schemaVersion: 1,
    sdkType: "system",
    kind: "system.init",
    callId: null,
    requestId: null,
    status: null,
    payload: {},
    raw: null,
    payloadBytes: 0,
    rawBytes: 0,
    occurredAt: "2026-05-23T10:00:00.000Z",
    receivedAt: "2026-05-23T10:00:00.000Z",
    createdAt: "2026-05-23T10:00:00.000Z",
  };
}

describe("RunBus", () => {
  it("publishes events to subscribers of the matching runId only", async () => {
    const bus = createRunBus();
    const seenA: number[] = [];
    const seenB: number[] = [];
    bus.subscribe("run-A", (e) => seenA.push(e.seq));
    bus.subscribe("run-B", (e) => seenB.push(e.seq));

    bus.publish("run-A", fakeEvent("run-A", 1));
    bus.publish("run-B", fakeEvent("run-B", 1));
    bus.publish("run-A", fakeEvent("run-A", 2));

    // setImmediate fanout — flush the queue.
    await new Promise((r) => setImmediate(r));

    expect(seenA).toEqual([1, 2]);
    expect(seenB).toEqual([1]);
  });

  it("supports multiple subscribers on the same run", async () => {
    const bus = createRunBus();
    const a: number[] = [];
    const b: number[] = [];
    bus.subscribe("run-A", (e) => a.push(e.seq));
    bus.subscribe("run-A", (e) => b.push(e.seq));
    bus.publish("run-A", fakeEvent("run-A", 1));
    await new Promise((r) => setImmediate(r));
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
  });

  it("unsubscribes cleanly", async () => {
    const bus = createRunBus();
    const seen: number[] = [];
    const off = bus.subscribe("run-A", (e) => seen.push(e.seq));
    bus.publish("run-A", fakeEvent("run-A", 1));
    await new Promise((r) => setImmediate(r));
    off();
    bus.publish("run-A", fakeEvent("run-A", 2));
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual([1]);
    expect(bus.hasSubscribers("run-A")).toBe(false);
  });

  it("snapshots listeners before iterating so self-unsubscribe is safe", async () => {
    const bus = createRunBus();
    const seen: string[] = [];
    let unsub: (() => void) | null = null;
    unsub = bus.subscribe("run-A", () => {
      seen.push("a");
      unsub?.();
    });
    bus.subscribe("run-A", () => {
      seen.push("b");
    });
    bus.publish("run-A", fakeEvent("run-A", 1));
    await new Promise((r) => setImmediate(r));
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  it("swallows listener errors so one bad subscriber can't break the publisher", async () => {
    const bus = createRunBus();
    const okSpy = vi.fn();
    bus.subscribe("run-A", () => {
      throw new Error("kaboom");
    });
    bus.subscribe("run-A", okSpy);
    expect(() => bus.publish("run-A", fakeEvent("run-A", 1))).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(okSpy).toHaveBeenCalledOnce();
  });

  it("reports hasSubscribers / size correctly", () => {
    const bus = createRunBus();
    expect(bus.hasSubscribers("run-A")).toBe(false);
    expect(bus.size()).toBe(0);
    const off = bus.subscribe("run-A", () => {});
    expect(bus.hasSubscribers("run-A")).toBe(true);
    expect(bus.size()).toBe(1);
    off();
    expect(bus.hasSubscribers("run-A")).toBe(false);
    expect(bus.size()).toBe(0);
  });
});
