import { describe, it, expect, beforeEach } from "vitest";
import {
  publishStreamingText,
  subscribeStreamingText,
  __resetForTests,
} from "../streaming-text-channel.js";

// Regression coverage for F-006. The streaming-text channel must:
//   1. Replay the latest published update to subscribers that register
//      AFTER the publish (the cold-mount case for the very first
//      assistant delta).
//   2. Survive React StrictMode's mount → cleanup → re-mount cycle —
//      i.e. the buffer cannot be deleted when the last subscriber
//      unsubscribes, because StrictMode's cleanup-then-re-subscribe
//      would wipe it between the two mounts.
//   3. Stay bounded under long sessions — the latest-update map evicts
//      the oldest entry when it exceeds LATEST_UPDATE_CAP.

describe("streaming-text-channel — F-006", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("replays the latest update to a subscriber that registers after publish", () => {
    publishStreamingText("a", { text: "STREAMING WORKS", isReplacement: false });
    const seen: string[] = [];
    const unsub = subscribeStreamingText("a", (u) => seen.push(u.text));
    unsub();
    expect(seen).toEqual(["STREAMING WORKS"]);
  });

  it("preserves the buffer across StrictMode's unsubscribe + re-subscribe", () => {
    publishStreamingText("a", { text: "FIRST DELTA", isReplacement: false });
    let first: string | null = null;
    const unsub1 = subscribeStreamingText("a", (u) => {
      first = u.text;
    });
    expect(first).toBe("FIRST DELTA");
    unsub1();
    let second: string | null = null;
    const unsub2 = subscribeStreamingText("a", (u) => {
      second = u.text;
    });
    expect(second).toBe("FIRST DELTA");
    unsub2();
  });

  it("delivers live updates to current subscribers", () => {
    const captured: string[] = [];
    const unsub = subscribeStreamingText("a", (u) => captured.push(u.text));
    publishStreamingText("a", { text: "alpha", isReplacement: false });
    publishStreamingText("a", { text: "beta", isReplacement: false });
    unsub();
    expect(captured).toEqual(["alpha", "beta"]);
  });

  it("isolates subscribers across distinct streamIds", () => {
    const seenA: string[] = [];
    const seenB: string[] = [];
    subscribeStreamingText("a", (u) => seenA.push(u.text));
    subscribeStreamingText("b", (u) => seenB.push(u.text));
    publishStreamingText("a", { text: "A-only", isReplacement: false });
    publishStreamingText("b", { text: "B-only", isReplacement: false });
    expect(seenA).toEqual(["A-only"]);
    expect(seenB).toEqual(["B-only"]);
  });

  it("caps the latest-update map and evicts oldest entries (FIFO)", () => {
    // Publish more than the cap (2000). The oldest entries must be
    // evicted; the newest entries must still replay to new subscribers.
    const N = 2100;
    for (let i = 0; i < N; i++) {
      publishStreamingText(`s${i}`, { text: `t${i}`, isReplacement: false });
    }
    // Oldest 100 should have been evicted.
    let oldestSeen: string | null = null;
    subscribeStreamingText("s0", (u) => {
      oldestSeen = u.text;
    })();
    expect(oldestSeen).toBeNull();
    // Most recent should still replay.
    let newestSeen: string | null = null;
    subscribeStreamingText(`s${N - 1}`, (u) => {
      newestSeen = u.text;
    })();
    expect(newestSeen).toBe(`t${N - 1}`);
  });

  it("re-publishing to an existing streamId refreshes its FIFO position", () => {
    // First entry should normally be evicted first. Re-publishing
    // refreshes its insertion order so it survives.
    publishStreamingText("old", { text: "v1", isReplacement: false });
    for (let i = 0; i < 1999; i++) {
      publishStreamingText(`filler-${i}`, { text: "x", isReplacement: false });
    }
    // Refresh "old" — it should now be the newest entry.
    publishStreamingText("old", { text: "v2", isReplacement: false });
    // Force one eviction by adding a new entry above the cap.
    publishStreamingText("trigger", { text: "x", isReplacement: false });
    let oldSeen: string | null = null;
    subscribeStreamingText("old", (u) => {
      oldSeen = u.text;
    })();
    expect(oldSeen).toBe("v2");
  });
});
