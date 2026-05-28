import { describe, expect, it } from "vitest";
import type { CanonicalRunEvent } from "../../state/run-store.js";
import {
  buildTimelineSegments,
  deriveTextForSeqRange,
  deriveTextForSeqRangeFromRunState,
  deriveThinkingDurationForSeqRange,
} from "../timeline-segments.js";

const BASE: Omit<CanonicalRunEvent, "sdk_type" | "kind" | "payload" | "seq" | "event_id"> = {
  schema_version: 1,
  agent_id: "agent-1",
  run_id: "run-1",
  occurred_at: "2026-05-23T00:00:00.000Z",
  received_at: "2026-05-23T00:00:00.000Z",
};

function event(
  seq: number,
  sdkType: CanonicalRunEvent["sdk_type"],
  kind: string,
  payload: unknown,
): CanonicalRunEvent {
  return {
    ...BASE,
    event_id: `evt-${seq}`,
    seq,
    sdk_type: sdkType,
    kind,
    payload,
  };
}

describe("buildTimelineSegments", () => {
  it("interleaves assistant and tool call blocks in seq order", () => {
    const chunks = [
      [
        event(1, "user", "user.message", { text: "hi" }),
        event(2, "assistant", "assistant.delta", { text_delta: "Looking into " }),
        event(3, "tool_call", "tool_call.running", { call_id: "c1", name: "grep", status: "running" }),
        event(4, "tool_call", "tool_call.completed", { call_id: "c1", name: "grep", status: "completed" }),
        event(5, "assistant", "assistant.delta", { text_delta: "done." }),
        event(6, "tool_call", "tool_call.running", { call_id: "c2", name: "shell", status: "running" }),
      ],
    ];

    const segments = buildTimelineSegments(chunks);
    expect(segments.map((segment) => segment.type)).toEqual([
      "user",
      "assistant",
      "tool_call_group",
      "assistant",
      "tool_call_group",
    ]);
    expect(segments[2]?.type === "tool_call_group" ? segments[2].callIds : []).toEqual(["c1"]);
    expect(segments[4]?.type === "tool_call_group" ? segments[4].callIds : []).toEqual(["c2"]);
  });

  it("starts a fresh assistant block after a user turn", () => {
    const chunks = [
      [
        event(1, "user", "user.message", { text: "first" }),
        event(2, "assistant", "assistant.delta", { text_delta: "a" }),
        event(3, "user", "user.message", { text: "second" }),
        event(4, "assistant", "assistant.delta", { text_delta: "b" }),
      ],
    ];

    const segments = buildTimelineSegments(chunks);
    expect(segments.filter((segment) => segment.type === "assistant")).toHaveLength(2);
  });

  it("keeps stable React keys while assistant and tool blocks grow", () => {
    const chunks = [
      [
        event(1, "assistant", "assistant.delta", { text_delta: "a" }),
        event(2, "assistant", "assistant.delta", { text_delta: "b" }),
        event(3, "tool_call", "tool_call.running", { call_id: "c1", name: "grep", status: "running" }),
        event(4, "tool_call", "tool_call.running", { call_id: "c2", name: "glob", status: "running" }),
      ],
    ];

    const growing = buildTimelineSegments(chunks);
    expect(growing[0]?.type === "assistant" ? growing[0].key : "").toBe("assistant-1");
    expect(growing[1]?.type === "tool_call_group" ? growing[1].key : "").toBe("tools-3");
    if (growing[1]?.type === "tool_call_group") {
      expect(growing[1].callIds).toEqual(["c1", "c2"]);
    }
  });
});

describe("deriveTextForSeqRange", () => {
  it("accumulates only assistant events inside the range", () => {
    const events = [
      event(1, "assistant", "assistant.delta", { text_delta: "Hello " }),
      event(2, "tool_call", "tool_call.running", { call_id: "c1", name: "grep", status: "running" }),
      event(3, "assistant", "assistant.delta", { text_delta: "world" }),
    ];

    expect(deriveTextForSeqRange(events, "assistant", 1, 1)).toBe("Hello ");
    expect(deriveTextForSeqRange(events, "assistant", 3, 3)).toBe("world");
  });

  it("derives scoped text from seqList and bySeq without flattening chunks", () => {
    const events = [
      event(1, "assistant", "assistant.delta", { text_delta: "Hello " }),
      event(2, "tool_call", "tool_call.running", { call_id: "c1", name: "grep", status: "running" }),
      event(3, "assistant", "assistant.delta", { text_delta: "world" }),
    ];
    const bySeq = new Map(events.map((evt) => [evt.seq, evt]));
    const seqList = events.map((evt) => evt.seq);

    expect(
      deriveTextForSeqRangeFromRunState({ seqList, bySeq }, "assistant", 1, 3),
    ).toBe("Hello world");
  });
});

describe("deriveThinkingDurationForSeqRange", () => {
  it("returns the latest duration inside the segment range", () => {
    const events = [
      event(1, "thinking", "thinking.delta", { text_delta: "hmm", thinking_duration_ms: 120 }),
      event(2, "thinking", "thinking.delta", { text_delta: " more", thinking_duration_ms: 450 }),
      event(3, "assistant", "assistant.delta", { text_delta: "answer" }),
    ];
    const bySeq = new Map(events.map((evt) => [evt.seq, evt]));
    const seqList = events.map((evt) => evt.seq);

    expect(deriveThinkingDurationForSeqRange({ seqList, bySeq }, 1, 2)).toBe(450);
  });
});
