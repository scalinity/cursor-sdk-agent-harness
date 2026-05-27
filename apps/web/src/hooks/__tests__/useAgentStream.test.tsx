import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientFrame, ServerFrame } from "@harness/shared";
import { useRunStore } from "../../state/run-store.js";
import { useUiStore } from "../../state/ui-store.js";
import { useAgentStream } from "../useAgentStream.js";

const h = vi.hoisted(() => ({
  config: null as null | { onFrame: (frame: ServerFrame) => void },
  sent: [] as ClientFrame[],
  connectionState: "open" as const,
}));

vi.mock("../useCsrfToken.js", () => ({
  useCsrfToken: () => ({ refresh: vi.fn() }),
}));

vi.mock("../useWebSocket.js", () => ({
  useWebSocket: (config: { onFrame: (frame: ServerFrame) => void }) => {
    h.config = config;
    return {
      send: (frame: ClientFrame) => h.sent.push(frame),
      connectionState: h.connectionState,
    };
  },
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

function retryableError(ackFor: string): ServerFrame {
  return {
    id: `err-${ackFor}`,
    type: "error",
    sent_at: "2026-05-23T00:00:01.000Z",
    ack_for: ackFor,
    code: "INTERNAL_ERROR",
    message: "resync",
    retryable: true,
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useAgentStream", () => {
  beforeEach(() => {
    h.config = null;
    h.sent = [];
    useRunStore.setState({ byId: {}, eventsByRunId: {}, activeRunId: null });
    useUiStore.setState({ csrfToken: "csrf-token", connectionState: "open" });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("retries retryable subscribe errors with the current run cursor and then stops", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useRunStore.getState().ingestServerFrame(assistantFrame(5));
    renderHook(() => useAgentStream({ agentId: "agent-1", runId: "run-1" }));

    await waitFor(() => expect(h.sent).toHaveLength(1));
    expect(h.sent[0]?.type).toBe("subscribe_run");
    expect(h.sent[0]?.type === "subscribe_run" ? h.sent[0].after_seq : null).toBe(5);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const frame = h.sent[h.sent.length - 1]!;
      act(() => h.config?.onFrame(retryableError(frame.id)));
      await flushMicrotasks();
    }
    expect(h.sent).toHaveLength(4);
    expect(h.sent.every((frame) => frame.type === "subscribe_run")).toBe(true);
    expect(
      h.sent.map((frame) => (frame.type === "subscribe_run" ? frame.after_seq : null)),
    ).toEqual([5, 5, 5, 5]);

    const last = h.sent[h.sent.length - 1]!;
    act(() => h.config?.onFrame(retryableError(last.id)));
    await flushMicrotasks();

    expect(h.sent).toHaveLength(4);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("ignores retryable subscribe errors after the run is unsubscribed", async () => {
    const { rerender } = renderHook(
      ({ runId }: { runId: string | null }) =>
        useAgentStream({ agentId: "agent-1", runId }),
      { initialProps: { runId: "run-1" as string | null } },
    );

    await waitFor(() => expect(h.sent).toHaveLength(1));
    const firstSubscribe = h.sent[0]!;

    rerender({ runId: null });
    await waitFor(() => expect(h.sent.some((frame) => frame.type === "unsubscribe_run")).toBe(true));

    act(() => h.config?.onFrame(retryableError(firstSubscribe.id)));
    await flushMicrotasks();

    expect(h.sent.filter((frame) => frame.type === "subscribe_run")).toHaveLength(1);
  });
});
