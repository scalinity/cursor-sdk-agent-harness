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
  StreamingMarkdown: ({ source }: { source: string }) => (
    <div data-testid={`streaming-markdown-${source}`} />
  ),
}));
vi.mock("../streaming/ThinkingTrace.js", () => ({
  ThinkingTrace: () => <div data-testid="thinking-trace" />,
}));
vi.mock("../streaming/ToolCallLane.js", () => ({
  ToolCallLane: () => <div data-testid="tool-call-lane" />,
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

  it("renders an approval outcome even when the originating request row is absent", () => {
    useRunStore.getState().ingestServerFrame(approvalFailedFrame(7));

    render(<EventTimeline runId="run-1" />);

    expect(screen.getByTestId("approval-prompt").textContent).toBe("failed");
  });
});
