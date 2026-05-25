import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSubagentMonitor } from "../useSubagentMonitor.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useSubagentMonitor", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:05.000Z"));
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        subagents: [
          {
            runId: "subagent-a",
            name: "Reviewer A",
            status: "RUNNING",
            startedAt: "2026-05-25T12:00:00.000Z",
            completedAt: null,
            tokenCount: 12,
            costMicros: null,
            lastEvents: [
              {
                kind: "tool_call.running",
                summary: "read_file src/app.ts",
                timestamp: "2026-05-25T12:00:01.000Z",
              },
            ],
          },
        ],
        activeCount: 1,
        completedCount: 0,
        totalTokens: 12,
        totalCostMicros: null,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates subagents from the recovery endpoint and exposes aggregate state", async () => {
    const { result } = renderHook(() => useSubagentMonitor("run-parent"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-parent/subagents", expect.any(Object));
    expect(result.current.hasSubagents).toBe(true);
    expect(result.current.activeCount).toBe(1);
    expect(result.current.completedCount).toBe(0);
    expect(result.current.totalTokens).toBe(12);
    expect(result.current.subagents[0]).toMatchObject({
      runId: "subagent-a",
      elapsedMs: 5_000,
      lastEvents: [{ kind: "tool_call.running" }],
    });
  });

  it("updates elapsedMs every second for running subagents", async () => {
    const { result } = renderHook(() => useSubagentMonitor("run-parent"));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.subagents[0]?.elapsedMs).toBe(5_000);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.subagents[0]?.elapsedMs).toBe(6_000);
  });
});
