import { describe, it, expect, beforeEach } from "vitest";
import {
  publishStreamingText,
  subscribeStreamingText,
} from "../streaming-text-channel.js";

// Regression coverage for F-006. The streaming-text channel must:
//   1. Replay the latest published update to subscribers that register
//      AFTER the publish (the cold-mount case for the very first
//      assistant delta).
//   2. Survive React StrictMode's mount → cleanup → re-mount cycle —
//      i.e. the buffer cannot be deleted when the last subscriber
//      unsubscribes, because StrictMode's cleanup-then-re-subscribe
//      would wipe it between the two mounts.

describe("streaming-text-channel — F-006", () => {
  const ID = "test-stream-1";
  beforeEach(() => {
    // Clear any leftover state by subscribing → unsubscribing → publishing
    // a placeholder. The channel intentionally retains buffers across
    // last-unsubscribe (F-006), so use unique IDs per test to isolate.
  });

  it("replays the latest update to a subscriber that registers after publish", () => {
    const sid = `${ID}:replay`;
    publishStreamingText(sid, { text: "STREAMING WORKS", isReplacement: false });
    const seen: string[] = [];
    const unsub = subscribeStreamingText(sid, (u) => seen.push(u.text));
    unsub();
    expect(seen).toEqual(["STREAMING WORKS"]);
  });

  it("preserves the buffer across StrictMode's unsubscribe + re-subscribe", () => {
    const sid = `${ID}:strict-mode`;
    publishStreamingText(sid, { text: "FIRST DELTA", isReplacement: false });
    // First mount.
    let first: string | null = null;
    const unsub1 = subscribeStreamingText(sid, (u) => {
      first = u.text;
    });
    expect(first).toBe("FIRST DELTA");
    // StrictMode tears down the effect, then re-runs it.
    unsub1();
    let second: string | null = null;
    const unsub2 = subscribeStreamingText(sid, (u) => {
      second = u.text;
    });
    expect(second).toBe("FIRST DELTA");
    unsub2();
  });

  it("delivers live updates to current subscribers", () => {
    const sid = `${ID}:live`;
    const captured: string[] = [];
    const unsub = subscribeStreamingText(sid, (u) => captured.push(u.text));
    publishStreamingText(sid, { text: "alpha", isReplacement: false });
    publishStreamingText(sid, { text: "beta", isReplacement: false });
    unsub();
    expect(captured).toEqual(["alpha", "beta"]);
  });

  it("isolates subscribers across distinct streamIds", () => {
    const a = `${ID}:iso-a`;
    const b = `${ID}:iso-b`;
    const seenA: string[] = [];
    const seenB: string[] = [];
    subscribeStreamingText(a, (u) => seenA.push(u.text));
    subscribeStreamingText(b, (u) => seenB.push(u.text));
    publishStreamingText(a, { text: "A-only", isReplacement: false });
    publishStreamingText(b, { text: "B-only", isReplacement: false });
    expect(seenA).toEqual(["A-only"]);
    expect(seenB).toEqual(["B-only"]);
  });
});
