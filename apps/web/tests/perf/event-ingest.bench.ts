import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerFrame } from "@harness/shared";
import { ToolCallLane } from "../../src/components/streaming/ToolCallLane.js";
import { useRunStore } from "../../src/state/run-store.js";

const BASE_EVENT = {
  schema_version: 1 as const,
  agent_id: "agent-bench",
  run_id: "run-bench",
  occurred_at: "2026-05-23T00:00:00.000Z",
  received_at: "2026-05-23T00:00:00.000Z",
};

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

function assistantFrame(seq: number): ServerFrame {
  return {
    id: `bench-frame-${seq.toString()}`,
    type: "sdk.assistant",
    sent_at: BASE_EVENT.occurred_at,
    event: {
      ...BASE_EVENT,
      event_id: `00000000-0000-0000-0000-${seq.toString().padStart(12, "0")}`,
      sdk_type: "assistant",
      seq,
      kind: "assistant.delta",
      payload: {
        role: "assistant",
        text_delta: `token-${seq.toString()} `,
        is_replacement: false,
        tool_uses: [],
      },
    },
  };
}

function toolFrame(seq: number): ServerFrame {
  return {
    id: `bench-tool-frame-${seq.toString()}`,
    type: "sdk.tool_call",
    sent_at: BASE_EVENT.occurred_at,
    event: {
      ...BASE_EVENT,
      event_id: `00000000-0000-0000-0000-${seq.toString().padStart(12, "0")}`,
      sdk_type: "tool_call",
      seq,
      kind: "tool_call.running",
      payload: {
        call_id: `bench-call-${seq.toString()}`,
        name: "read_file",
        status: "running",
        args: { path: "src/file.ts" },
      },
    },
  };
}

describe("event ingest perf", () => {
  afterEach(() => cleanup());

  it("ingests 10,000 frames inside the Phase 09 client budget with mounted subscribers", () => {
    useRunStore.setState({ byId: {}, eventsByRunId: {}, activeRunId: null });
    act(() => {
      useRunStore.getState().ingestServerFrame(toolFrame(1));
      useRunStore.getState().ingestServerFrame(toolFrame(2));
    });
    render(createElement(ToolCallLane, { runId: "run-bench" }));
    const times: number[] = [];

    for (let i = 3; i <= 10_002; i += 1) {
      const start = performance.now();
      act(() => useRunStore.getState().ingestServerFrame(assistantFrame(i)));
      times.push(performance.now() - start);
    }

    const p50 = percentile(times, 0.5);
    const p95 = percentile(times, 0.95);
    console.info(`[bench] event ingest p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms`);

    expect(p50).toBeLessThan(2);
    expect(p95).toBeLessThan(8);
  });
});
