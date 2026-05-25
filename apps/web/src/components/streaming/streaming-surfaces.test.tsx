import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CostBadge } from "./CostBadge.js";
import { JsonInspector } from "./JsonInspector.js";
import { StreamingSurfaceBoundary } from "./StreamingSurfaceBoundary.js";
import { useRunStore } from "../../state/run-store.js";

function resetRunStore() {
  useRunStore.setState({ byId: {}, eventsByRunId: {}, activeRunId: null });
}

function Bomb() {
  throw new Error("boom");
  return null;
}

describe("streaming surfaces", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("renders all CostBadge usage states", () => {
    resetRunStore();
    useRunStore.setState({
      byId: {
        pending: {
          id: "pending",
          agentId: "agent-1",
          status: "RUNNING",
          startedAt: null,
          finishedAt: null,
          finalText: null,
          interruptedReason: null,
          usage: null,
          usageSource: null,
          durationMs: null,
          modelId: null,
          lastTurnInputTokens: null,
          lastTurnOutputTokens: null,
        },
        final: {
          id: "final",
          agentId: "agent-1",
          status: "FINISHED",
          startedAt: null,
          finishedAt: null,
          finalText: null,
          interruptedReason: null,
          usage: {
            input_tokens: 1000,
            output_tokens: 4288,
            cached_input_tokens: null,
            reasoning_tokens: null,
            cost_usd_micros: 12_345,
            usage_source: "sdk_final_result",
          },
          usageSource: "sdk_final_result",
          durationMs: 10,
          modelId: null,
          lastTurnInputTokens: null,
          lastTurnOutputTokens: null,
        },
        pricingMissing: {
          id: "pricingMissing",
          agentId: "agent-1",
          status: "FINISHED",
          startedAt: null,
          finishedAt: null,
          finalText: null,
          interruptedReason: null,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cached_input_tokens: null,
            reasoning_tokens: null,
            cost_usd_micros: null,
            usage_source: "sdk_final_result",
          },
          usageSource: "sdk_final_result",
          durationMs: 10,
          modelId: null,
          lastTurnInputTokens: null,
          lastTurnOutputTokens: null,
        },
        unavailable: {
          id: "unavailable",
          agentId: "agent-1",
          status: "FINISHED",
          startedAt: null,
          finishedAt: null,
          finalText: null,
          interruptedReason: null,
          usage: {
            input_tokens: null,
            output_tokens: null,
            cached_input_tokens: null,
            reasoning_tokens: null,
            cost_usd_micros: null,
            usage_source: "unavailable",
          },
          usageSource: "unavailable",
          durationMs: null,
          modelId: null,
          lastTurnInputTokens: null,
          lastTurnOutputTokens: null,
        },
      },
      eventsByRunId: {},
      activeRunId: null,
    });

    const { rerender } = render(<CostBadge runId="pending" />);
    expect(screen.getByText("Usage pending")).not.toBeNull();

    rerender(<CostBadge runId="final" />);
    expect(screen.getByText(/\$0\.0123/)).not.toBeNull();
    expect(screen.getByText(/5,288 tok/)).not.toBeNull();

    rerender(<CostBadge runId="pricingMissing" />);
    expect(screen.getByText("Tokens recorded, pricing not configured")).not.toBeNull();

    rerender(<CostBadge runId="unavailable" />);
    expect(screen.getByText("Usage unavailable")).not.toBeNull();
  });

  it("lazy-loads large JSON payloads when expanded", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ value: { nested: "loaded" }, byteCount: 4096 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <JsonInspector
        label="result"
        payloadRef={{ url: "/api/events/evt-1/large-payload/result", byteCount: 4096 }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /payload 4,096 bytes/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events/evt-1/large-payload/result",
        expect.any(Object),
      ),
    );
    expect(await screen.findByText("nested")).not.toBeNull();
    expect(screen.getByText('"loaded"')).not.toBeNull();
  });

  it("catches one surface render failure without unmounting siblings", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <div>
        <StreamingSurfaceBoundary surface="tool-card">
          <Bomb />
        </StreamingSurfaceBoundary>
        <span>still mounted</span>
      </div>,
    );

    expect(screen.getByText(/tool-card failed to render/i)).not.toBeNull();
    expect(screen.getByText("still mounted")).not.toBeNull();
    spy.mockRestore();
  });
});
