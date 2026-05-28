import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFrame } from "@harness/shared";
import { useRunStore } from "../../state/run-store.js";
import { EventTimeline } from "./EventTimeline.js";

vi.mock("../../hooks/useRunHealth.js", () => ({
  useRunHealth: () => ({
    toolCallHealth: {},
    runStalled: false,
    msSinceLastEvent: null,
  }),
}));

vi.mock("../streaming/StreamingMarkdown.js", () => ({
  StreamingMarkdown: ({ source, startSeq, endSeq }: { source: string; startSeq?: number; endSeq?: number }) => (
    <div
      data-testid={`streaming-markdown-${source}`}
      data-start-seq={startSeq ?? ""}
      data-end-seq={endSeq ?? ""}
    />
  ),
}));
vi.mock("../streaming/ThinkingTrace.js", () => ({
  ThinkingTrace: () => <div data-testid="thinking-trace" />,
}));
vi.mock("../streaming/ToolCallLane.js", () => ({
  ToolCallLane: ({ callIds }: { callIds?: readonly string[] }) => (
    <div data-testid="tool-call-lane" data-call-ids={(callIds ?? []).join(",")} />
  ),
}));
vi.mock("../streaming/CodeEditPreviewPanel.js", () => ({
  CodeEditPreviewPanel: () => <div data-testid="code-edit-panel" />,
}));
vi.mock("../streaming/ApprovalPrompt.js", () => ({
  ApprovalPrompt: ({ approval }: { approval: { status: string } }) => (
    <div data-testid="approval-prompt">{approval.status}</div>
  ),
}));

const BASE_EVENT = {
  schema_version: 1 as const,
  agent_id: "agent-1",
  run_id: "run-1",
  occurred_at: "2026-05-23T00:00:00.000Z",
  received_at: "2026-05-23T00:00:00.000Z",
};

function assistantFrame(seq: number): ServerFrame {
  return {
    id: `frame-${seq}`,
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
        text_delta: "x",
        is_replacement: false,
        tool_uses: [],
      },
    },
  };
}

function approvalFailedFrame(seq: number): ServerFrame {
  return {
    id: `approval-${seq}`,
    type: "approval.failed",
    sent_at: BASE_EVENT.occurred_at,
    event: {
      ...BASE_EVENT,
      event_id: `00000000-0000-0000-0000-${seq.toString().padStart(12, "0")}`,
      sdk_type: "request",
      seq,
      kind: "approval.failed",
      payload: {
        request_id: "req-1",
        decision: "approve",
        failed_at: "2026-05-23T00:00:01.000Z",
        code: "APPROVAL_UNIMPLEMENTED",
        message: "not implemented",
      },
    },
  };
}

function toolCallFrame(seq: number, callId: string, status: "running" | "completed"): ServerFrame {
  return {
    id: `tool-${seq}`,
    type: "sdk.tool_call",
    sent_at: BASE_EVENT.occurred_at,
    event: {
      ...BASE_EVENT,
      event_id: `00000000-0000-0000-0000-${seq.toString().padStart(12, "0")}`,
      sdk_type: "tool_call",
      seq,
      kind: status === "running" ? "tool_call.running" : "tool_call.completed",
      payload: {
        call_id: callId,
        name: "grep",
        status,
      },
    },
  };
}

describe("EventTimeline", () => {
  beforeEach(() => {
    useRunStore.setState({ byId: {}, eventsByRunId: {}, activeRunId: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the empty run prompt when no run is selected", () => {
    render(<EventTimeline runId={null} />);

    expect(screen.getByText(/Select a run/)).toBeTruthy();
  });

  it("renders assistant content from chunked event storage only once", () => {
    for (let seq = 1; seq <= 300; seq += 1) {
      useRunStore.getState().ingestServerFrame(assistantFrame(seq));
    }

    render(<EventTimeline runId="run-1" />);

    expect(screen.getAllByTestId("streaming-markdown-assistant")).toHaveLength(1);
    expect(useRunStore.getState().eventsByRunId["run-1"]?.eventChunks).toHaveLength(2);
  });

  it("interleaves tool lanes between assistant segments", () => {
    useRunStore.getState().ingestServerFrame(assistantFrame(1));
    useRunStore.getState().ingestServerFrame(toolCallFrame(2, "call-1", "running"));
    useRunStore.getState().ingestServerFrame(toolCallFrame(3, "call-1", "completed"));
    useRunStore.getState().ingestServerFrame(assistantFrame(4));

    const { container } = render(<EventTimeline runId="run-1" />);
    const assistantNodes = screen.getAllByTestId("streaming-markdown-assistant");
    const toolLanes = screen.getAllByTestId("tool-call-lane");

    expect(assistantNodes).toHaveLength(2);
    expect(toolLanes).toHaveLength(1);
    expect(toolLanes[0]?.getAttribute("data-call-ids")).toBe("call-1");

    const orderedTestIds = Array.from(container.querySelectorAll("[data-testid]")).map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(orderedTestIds).toEqual([
      "streaming-markdown-assistant",
      "tool-call-lane",
      "streaming-markdown-assistant",
    ]);
  });

  it("renders an approval outcome even when the originating request row is absent", () => {
    useRunStore.getState().ingestServerFrame(approvalFailedFrame(7));

    render(<EventTimeline runId="run-1" />);

    expect(screen.getByTestId("approval-prompt").textContent).toBe("failed");
  });

  it("does not render inline status rows around assistant output", () => {
    useRunStore.getState().ingestServerFrame({
      id: "status-1",
      type: "sdk.status",
      sent_at: BASE_EVENT.occurred_at,
      event: {
        ...BASE_EVENT,
        event_id: "00000000-0000-0000-0000-000000000001",
        sdk_type: "status",
        seq: 1,
        kind: "status.changed",
        payload: { status: "FINISHED" },
      },
    });
    useRunStore.getState().ingestServerFrame(assistantFrame(2));
    useRunStore.getState().ingestServerFrame({
      id: "final-3",
      type: "run.final_result",
      sent_at: BASE_EVENT.occurred_at,
      event: {
        ...BASE_EVENT,
        event_id: "00000000-0000-0000-0000-000000000003",
        sdk_type: "status",
        seq: 3,
        kind: "run.final_result",
        payload: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: null,
            reasoning_tokens: null,
            cost_usd_micros: 5_800,
            usage_source: "sdk_final_result",
          },
        },
      },
    });

    render(<EventTimeline runId="run-1" />);

    expect(screen.queryByText("[status.changed]")).toBeNull();
    expect(screen.queryByText("[run.final_result]")).toBeNull();
    expect(screen.queryByText("FINISHED")).toBeNull();
    expect(screen.getAllByTestId("streaming-markdown-assistant")).toHaveLength(1);
  });
});
