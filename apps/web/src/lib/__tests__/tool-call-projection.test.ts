import { describe, expect, it } from "vitest";
import type { CanonicalRunEvent } from "../../state/run-store.js";
import { deriveToolCallProjections, groupToolCallLanes } from "../tool-call-projection.js";

function toolEvent(input: {
  seq: number;
  callId: string;
  status: "running" | "completed" | "error";
  name?: string;
  occurredAt?: string;
  args?: unknown;
  result?: unknown;
  durationMs?: number;
  largePayloadRefs?: {
    args_event_url?: string;
    result_event_url?: string;
    raw_event_url?: string;
  };
}): CanonicalRunEvent {
  return {
    event_id: `00000000-0000-0000-0000-${input.seq.toString().padStart(12, "0")}`,
    schema_version: 1,
    seq: input.seq,
    agent_id: "agent-1",
    run_id: "run-1",
    occurred_at: input.occurredAt ?? `2026-05-23T00:00:0${input.seq}.000Z`,
    received_at: input.occurredAt ?? `2026-05-23T00:00:0${input.seq}.000Z`,
    sdk_type: "tool_call",
    kind: `tool_call.${input.status}`,
    payload: {
      call_id: input.callId,
      name: input.name ?? "read_file",
      status: input.status,
      ...(input.args !== undefined ? { args: input.args } : {}),
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(input.durationMs !== undefined ? { timing: { duration_ms: input.durationMs } } : {}),
      ...(input.largePayloadRefs !== undefined ? { large_payload_refs: input.largePayloadRefs } : {}),
    },
  };
}

describe("tool call projection", () => {
  it("coalesces running and completed lifecycle events by call_id", () => {
    const projections = deriveToolCallProjections([
      toolEvent({ seq: 1, callId: "call-a", status: "running", args: { path: "a.ts" } }),
      toolEvent({
        seq: 3,
        callId: "call-a",
        status: "completed",
        result: { linesRead: 12 },
        durationMs: 142,
      }),
    ]);

    expect(projections).toEqual([
      expect.objectContaining({
        callId: "call-a",
        name: "read_file",
        status: "completed",
        startedAtSeq: 1,
        completedAtSeq: 3,
        durationMs: 142,
        args: { path: "a.ts" },
        result: { linesRead: 12 },
      }),
    ]);
  });

  it("groups overlapping current running calls into a side-by-side lane", () => {
    const projections = deriveToolCallProjections([
      toolEvent({ seq: 1, callId: "call-a", status: "running" }),
      toolEvent({ seq: 2, callId: "call-b", status: "running", name: "grep" }),
      toolEvent({ seq: 3, callId: "call-c", status: "completed", name: "shell" }),
    ]);

    expect(groupToolCallLanes(projections)).toEqual([
      { type: "lane", callIds: ["call-a", "call-b"] },
      { type: "card", callId: "call-c" },
    ]);
  });

  it("collapses historically overlapping calls back to stacked cards after completion", () => {
    const projections = deriveToolCallProjections([
      toolEvent({ seq: 1, callId: "call-a", status: "running" }),
      toolEvent({ seq: 2, callId: "call-b", status: "running", name: "grep" }),
      toolEvent({ seq: 3, callId: "call-a", status: "completed" }),
      toolEvent({ seq: 4, callId: "call-b", status: "completed" }),
    ]);

    expect(groupToolCallLanes(projections)).toEqual([
      { type: "card", callId: "call-a" },
      { type: "card", callId: "call-b" },
    ]);
  });

  it("preserves large payload URL refs from slim tool-call frames", () => {
    const projections = deriveToolCallProjections([
      toolEvent({
        seq: 1,
        callId: "call-a",
        status: "completed",
        largePayloadRefs: {
          args_event_url: "/api/events/evt-1/large-payload/args",
          result_event_url: "/api/events/evt-1/large-payload/result",
        },
      }),
    ]);

    expect(projections[0]).toMatchObject({
      largePayloadRefs: {
        argsEventUrl: "/api/events/evt-1/large-payload/args",
        resultEventUrl: "/api/events/evt-1/large-payload/result",
      },
    });
  });
});
