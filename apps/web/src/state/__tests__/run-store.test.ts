import { describe, it, expect, beforeEach } from "vitest";
import type { ServerFrame } from "@harness/shared";
import { useRunStore } from "../run-store.js";

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
});
