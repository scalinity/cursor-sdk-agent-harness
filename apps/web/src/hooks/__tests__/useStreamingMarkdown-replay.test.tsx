import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ServerFrame } from "@harness/shared";
import { __resetForTests } from "../../lib/streaming-text-channel.js";
import { useRunStore } from "../../state/run-store.js";
import { useStreamingMarkdown } from "../useStreamingMarkdown.js";

const BASE_EVENT = {
  schema_version: 1 as const,
  agent_id: "agent-1",
  run_id: "run-replay",
  occurred_at: "2026-05-23T00:00:00.000Z",
  received_at: "2026-05-23T00:00:00.000Z",
};

function assistantFrame(seq: number, delta: string): ServerFrame {
  return {
    id: `frame-${seq}`,
    type: "sdk.assistant",
    sent_at: BASE_EVENT.occurred_at,
    event: {
      ...BASE_EVENT,
      event_id: `evt-${seq}`,
      sdk_type: "assistant",
      seq,
      kind: "assistant.delta",
      payload: {
        role: "assistant",
        text_delta: delta,
        is_replacement: false,
        tool_uses: [],
      },
    },
  };
}

describe("useStreamingMarkdown replay reset", () => {
  beforeEach(() => {
    __resetForTests();
    useRunStore.setState({ byId: {}, eventsByRunId: {}, activeRunId: null });
  });

  it("renders the full replayed assistant text after a live partial session", async () => {
    const ingest = useRunStore.getState().ingestServerFrame;
    ingest(assistantFrame(1, "STREAM"));

    const { result, rerender } = renderHook(() =>
      useStreamingMarkdown({
        runId: "run-replay",
        source: "assistant",
        startSeq: 1,
        endSeq: 2,
      }),
    );

    await waitFor(() => {
      expect(result.current.fallbackText ?? result.current.blocks[0]?.type).toBeTruthy();
    });

    useRunStore.getState().resetRun("run-replay");
    ingest(assistantFrame(1, "STREAM"));
    ingest(assistantFrame(2, "ING WORKS"));
    rerender();

    await waitFor(() => {
      const text =
        result.current.fallbackText ??
        (result.current.blocks[0]?.type === "paragraph"
          ? result.current.blocks[0].text
          : "");
      expect(text).toBe("STREAMING WORKS");
    });
  });
});
