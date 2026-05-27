import { describe, it, expect, beforeEach } from "vitest";
import type { ServerFrame } from "@harness/shared";
import { flattenEventChunks, useRunStore, type RunEventState } from "../run-store.js";

function eventsFor(state: RunEventState) {
  return flattenEventChunks(state.eventChunks);
}

const BASE_EVENT = {
  schema_version: 1 as const,
  agent_id: "agent-1",
  run_id: "run-1",
  occurred_at: "2026-05-23T00:00:00.000Z",
  received_at: "2026-05-23T00:00:00.000Z",
};

function assistantFrame(seq: number, delta: string, isReplacement = false): ServerFrame {
  return {
    id: `frame-${seq}`,
    type: "sdk.assistant",
    sent_at: BASE_EVENT.occurred_at,
    event: {
      ...BASE_EVENT,
      event_id: `00000000-0000-0000-0000-${seq.toString().padStart(12, "0")}`,
      sdk_type: "assistant",
      seq,
      kind: isReplacement ? "assistant.snapshot" : "assistant.delta",
      payload: {
        role: "assistant",
        text_delta: delta,
        is_replacement: isReplacement,
        tool_uses: [],
      },
    },
  };
}

function statusFrame(seq: number, status: "RUNNING" | "FINISHED"): ServerFrame {
  return {
    id: `frame-${seq}`,
    type: "sdk.status",
    sent_at: BASE_EVENT.occurred_at,
    event: {
      ...BASE_EVENT,
      event_id: `00000000-0000-0000-0000-${seq.toString().padStart(12, "0")}`,
      sdk_type: "status",
      seq,
      kind: "status.changed",
      payload: { status },
    },
  };
}

function toolFrame(
  seq: number,
  callId: string,
  status: "running" | "completed" | "error" = "completed",
): ServerFrame {
  return {
    id: `tool-frame-${seq}`,
    type: "sdk.tool_call",
    sent_at: BASE_EVENT.occurred_at,
    event: {
      ...BASE_EVENT,
      event_id: `00000000-0000-0000-0000-${seq.toString().padStart(12, "0")}`,
      sdk_type: "tool_call",
      seq,
      kind: status === "running" ? "tool_call.running" : status === "error" ? "tool_call.error" : "tool_call.completed",
      payload: {
        call_id: callId,
        name: "read",
        status,
        args: { path: "x" },
        timing: { started_at: BASE_EVENT.occurred_at },
      },
    },
  };
}

describe("run-store", () => {
  beforeEach(() => {
    useRunStore.setState({
      byId: {},
      eventsByRunId: {},
      activeRunId: null,
    });
  });

  it("appends events in order and bumps lastSeq", () => {
    useRunStore.getState().ingestServerFrame(assistantFrame(1, "Hello"));
    useRunStore.getState().ingestServerFrame(assistantFrame(2, " world"));
    const state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(state.seqList).toEqual([1, 2]);
    expect(state.lastSeq).toBe(2);
    expect(state.assistantText).toBe("Hello world");
  });

  it("treats a snapshot with is_replacement as a full replace", () => {
    useRunStore.getState().ingestServerFrame(assistantFrame(1, "draft"));
    useRunStore.getState().ingestServerFrame(assistantFrame(2, "final answer", true));
    const state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(state.assistantText).toBe("final answer");
  });

  it("dedupes by seq — second ingest of same seq is a no-op", () => {
    useRunStore.getState().ingestServerFrame(assistantFrame(1, "Hi"));
    useRunStore.getState().ingestServerFrame(assistantFrame(1, "Hi"));
    const state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(state.seqList).toEqual([1]);
    expect(state.assistantText).toBe("Hi");
  });

  it("preserves server replay metadata without requiring caller options", () => {
    useRunStore.getState().ingestServerFrame({ ...assistantFrame(1, "Hi"), replayed: true });
    const state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(eventsFor(state)[0]?.replayed).toBe(true);
  });

  it("updates run status projection on sdk.status frames", () => {
    useRunStore.getState().ingestServerFrame(statusFrame(1, "RUNNING"));
    expect(useRunStore.getState().byId["run-1"]?.status).toBe("RUNNING");
    useRunStore.getState().ingestServerFrame(statusFrame(2, "FINISHED"));
    expect(useRunStore.getState().byId["run-1"]?.status).toBe("FINISHED");
  });

  it("resetRun clears the per-run buffer", () => {
    useRunStore.getState().ingestServerFrame(assistantFrame(1, "x"));
    useRunStore.getState().resetRun("run-1");
    expect(useRunStore.getState().eventsByRunId["run-1"]).toBeUndefined();
  });

  it("stores chunked events in seq order without relying on a flat ingest array", () => {
    useRunStore.getState().ingestServerFrame(assistantFrame(1, "A"));
    useRunStore.getState().ingestServerFrame(assistantFrame(2, "B"));
    const state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(state.eventChunks).toHaveLength(1);
    expect(eventsFor(state).map((e) => e.seq)).toEqual([1, 2]);
    expect(eventsFor(state)[0]!.payload).toEqual({
      role: "assistant",
      text_delta: "A",
      is_replacement: false,
      tool_uses: [],
    });
  });

  it("splits long runs into fixed-size event chunks", () => {
    for (let seq = 1; seq <= 300; seq += 1) {
      useRunStore.getState().ingestServerFrame(assistantFrame(seq, "x"));
    }
    const state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(state.eventChunks.map((chunk) => chunk.length)).toEqual([256, 44]);
    expect(eventsFor(state).at(-1)?.seq).toBe(300);
  });

  it("binary-inserts out-of-order seqs into chunks + seqList (RV2-S2)", () => {
    useRunStore.getState().ingestServerFrame(assistantFrame(1, "a"));
    useRunStore.getState().ingestServerFrame(assistantFrame(3, "c"));
    // Out-of-order: seq 2 arrives after seq 3.
    useRunStore.getState().ingestServerFrame(assistantFrame(2, "b"));
    const state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(state.seqList).toEqual([1, 2, 3]);
    expect(eventsFor(state).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("increments toolCallCount and tool projections per sdk.tool_call frame (RV2-S4)", () => {
    useRunStore.getState().ingestServerFrame(assistantFrame(1, "hi"));
    useRunStore.getState().ingestServerFrame(toolFrame(2, "call-2"));
    useRunStore.getState().ingestServerFrame(toolFrame(3, "call-3"));
    const state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(state.toolCallCount).toBe(2);
    expect(state.toolCallProjections.map((call) => call.callId)).toEqual(["call-2", "call-3"]);
  });

  it("projects CANCELLED status from run.interrupted with user_cancelled (RV2-W4)", () => {
    const interrupted: ServerFrame = {
      id: "frame-1",
      type: "run.interrupted",
      sent_at: BASE_EVENT.occurred_at,
      event: {
        ...BASE_EVENT,
        event_id: "00000000-0000-0000-0000-000000000001",
        sdk_type: "status",
        seq: 1,
        kind: "run.interrupted",
        payload: { reason: "user_cancelled" },
      },
    };
    useRunStore.getState().ingestServerFrame(interrupted);
    const run = useRunStore.getState().byId["run-1"]!;
    expect(run.status).toBe("CANCELLED");
    expect(run.interruptedReason).toBe("user_cancelled");
  });

  it("does not spread byId for streaming text deltas (RV2-S1)", () => {
    const before = useRunStore.getState().byId;
    useRunStore.getState().ingestServerFrame(assistantFrame(1, "stream"));
    // No projection frame fired, so byId reference should be unchanged.
    expect(useRunStore.getState().byId).toBe(before);
  });

  it("projects approval state as pending → resolved through ingest (Phase 13)", () => {
    const request: ServerFrame = {
      id: "f-1",
      type: "sdk.request",
      sent_at: BASE_EVENT.occurred_at,
      event: {
        ...BASE_EVENT,
        event_id: "00000000-0000-0000-0000-000000000001",
        sdk_type: "request",
        seq: 1,
        kind: "request.created",
        payload: {
          request_id: "req-1",
          context_event_ids: [],
          inferred_reason: null,
        },
      },
    };
    useRunStore.getState().ingestServerFrame(request);
    let state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(state.approvalsByRequestId["req-1"]?.status).toBe("pending");
    expect(state.approvalsByRequestId["req-1"]?.requestSeq).toBe(1);

    const resolved: ServerFrame = {
      id: "f-2",
      type: "approval.resolved",
      sent_at: BASE_EVENT.occurred_at,
      event: {
        ...BASE_EVENT,
        event_id: "00000000-0000-0000-0000-000000000002",
        sdk_type: "request",
        seq: 2,
        kind: "approval.resolved",
        payload: {
          request_id: "req-1",
          decision: "approve",
          resolved_at: "2026-05-23T01:00:00.000Z",
        },
      },
    };
    useRunStore.getState().ingestServerFrame(resolved);
    state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(state.approvalsByRequestId["req-1"]?.status).toBe("resolved");
    expect(state.approvalsByRequestId["req-1"]?.decision).toBe("approve");
  });

  it("projects approval.failed with APPROVAL_UNIMPLEMENTED code (Phase 13)", () => {
    const request: ServerFrame = {
      id: "f-3",
      type: "sdk.request",
      sent_at: BASE_EVENT.occurred_at,
      event: {
        ...BASE_EVENT,
        event_id: "00000000-0000-0000-0000-000000000003",
        sdk_type: "request",
        seq: 1,
        kind: "request.created",
        payload: {
          request_id: "req-2",
          context_event_ids: [],
          inferred_reason: null,
        },
      },
    };
    const failed: ServerFrame = {
      id: "f-4",
      type: "approval.failed",
      sent_at: BASE_EVENT.occurred_at,
      event: {
        ...BASE_EVENT,
        event_id: "00000000-0000-0000-0000-000000000004",
        sdk_type: "request",
        seq: 2,
        kind: "approval.failed",
        payload: {
          request_id: "req-2",
          decision: "approve",
          failed_at: "2026-05-23T01:00:00.000Z",
          code: "APPROVAL_UNIMPLEMENTED",
          message: "OQ-10 not resolved",
        },
      },
    };
    useRunStore.getState().ingestServerFrame(request);
    useRunStore.getState().ingestServerFrame(failed);
    const state = useRunStore.getState().eventsByRunId["run-1"]!;
    expect(state.approvalsByRequestId["req-2"]?.status).toBe("failed");
    expect(state.approvalsByRequestId["req-2"]?.code).toBe("APPROVAL_UNIMPLEMENTED");
  });

  it("projects server_restart interrupted as ERROR (Phase 13 crash recovery)", () => {
    const interrupted: ServerFrame = {
      id: "f-5",
      type: "run.interrupted",
      sent_at: BASE_EVENT.occurred_at,
      event: {
        ...BASE_EVENT,
        event_id: "00000000-0000-0000-0000-000000000005",
        sdk_type: "status",
        seq: 1,
        kind: "run.interrupted",
        payload: { reason: "server_restart" },
      },
    };
    useRunStore.getState().ingestServerFrame(interrupted);
    const run = useRunStore.getState().byId["run-1"]!;
    expect(run.status).toBe("ERROR");
    expect(run.interruptedReason).toBe("server_restart");
  });
});
