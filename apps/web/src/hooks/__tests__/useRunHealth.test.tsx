import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setUseRunHealthClockForTests,
  useRunHealth,
} from "../useRunHealth.js";
import { useRunStore } from "../../state/run-store.js";

function Probe(props: {
  runId: string;
  onResult: (result: ReturnType<typeof useRunHealth>) => void;
}) {
  const result = useRunHealth(props.runId);
  props.onResult(result);
  return null;
}

const RUN_ID = "run-health-test";

function seedRunWithRunningToolCall(receivedAtMs: number): void {
  useRunStore.setState((s) => ({
    ...s,
    byId: {
      [RUN_ID]: {
        id: RUN_ID,
        agentId: "agent",
        status: "RUNNING",
        startedAt: new Date(receivedAtMs).toISOString(),
        finishedAt: null,
        finalText: null,
        interruptedReason: null,
        usage: null,
        usageSource: null,
        durationMs: null,
      },
    },
    eventsByRunId: {
      [RUN_ID]: {
        seqList: [1],
        bySeq: new Map([
          [
            1,
            {
              event_id: "ev-1",
              schema_version: 1 as const,
              seq: 1,
              agent_id: "agent",
              run_id: RUN_ID,
              occurred_at: new Date(receivedAtMs).toISOString(),
              received_at: new Date(receivedAtMs).toISOString(),
              sdk_type: "tool_call" as const,
              kind: "tool_call.running",
              payload: {
                call_id: "call-1",
                name: "shell",
                status: "running",
                timing: { started_at: new Date(receivedAtMs).toISOString() },
              },
            },
          ],
        ]),
        events: [
          {
            event_id: "ev-1",
            schema_version: 1 as const,
            seq: 1,
            agent_id: "agent",
            run_id: RUN_ID,
            occurred_at: new Date(receivedAtMs).toISOString(),
            received_at: new Date(receivedAtMs).toISOString(),
            sdk_type: "tool_call" as const,
            kind: "tool_call.running",
            payload: {
              call_id: "call-1",
              name: "shell",
              status: "running",
              timing: { started_at: new Date(receivedAtMs).toISOString() },
            },
          },
        ],
        lastSeq: 1,
        assistantText: "",
        thinkingText: "",
        toolCallCount: 1,
        approvalsByRequestId: {},
      },
    },
  }));
}

describe("useRunHealth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store
    useRunStore.setState({ byId: {}, eventsByRunId: {}, activeRunId: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    __setUseRunHealthClockForTests(() => Date.now());
  });

  it("marks stillRunning after 30s and longRunning after 120s", () => {
    const startMs = 1_000_000;
    seedRunWithRunningToolCall(startMs);

    let now = startMs;
    __setUseRunHealthClockForTests(() => now);
    let last: ReturnType<typeof useRunHealth> | null = null;
    render(<Probe runId={RUN_ID} onResult={(r) => (last = r)} />);

    // Initial render — elapsed 0ms, neither badge set.
    expect(last!.toolCallHealth["call-1"]?.stillRunning).toBe(false);
    expect(last!.toolCallHealth["call-1"]?.longRunning).toBe(false);

    // Advance 35s — stillRunning, not yet longRunning.
    now = startMs + 35_000;
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(last!.toolCallHealth["call-1"]?.stillRunning).toBe(true);
    expect(last!.toolCallHealth["call-1"]?.longRunning).toBe(false);

    // Advance to 125s — both.
    now = startMs + 125_000;
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(last!.toolCallHealth["call-1"]?.stillRunning).toBe(true);
    expect(last!.toolCallHealth["call-1"]?.longRunning).toBe(true);
  });

  it("marks the run stalled when no event has arrived in >180s", () => {
    const startMs = 1_000_000;
    seedRunWithRunningToolCall(startMs);
    let now = startMs;
    __setUseRunHealthClockForTests(() => now);

    let last: ReturnType<typeof useRunHealth> | null = null;
    render(<Probe runId={RUN_ID} onResult={(r) => (last = r)} />);

    expect(last!.runStalled).toBe(false);

    now = startMs + 200_000;
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(last!.runStalled).toBe(true);
  });
});
