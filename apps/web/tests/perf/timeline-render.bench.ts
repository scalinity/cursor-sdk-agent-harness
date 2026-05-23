import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFrame } from "@harness/shared";
import { EventTimeline } from "../../src/components/shell/EventTimeline.js";
import { useRunStore } from "../../src/state/run-store.js";

/**
 * Phase 14 — timeline render benchmark.
 *
 * Spec §13 budget:
 *   - Timeline virtualization threshold: > 200 events
 *   - React render work per non-boundary event: < 4ms p50
 *
 * The existing `event-ingest.bench.ts` already covers the incremental
 * ingest path. This benchmark exercises the cold-mount path: pre-seed
 * 10,000 events in the run store, then mount the EventTimeline and
 * record how long the first render takes. The number isn't a hard
 * budget today (the component doesn't yet use `@tanstack/react-virtual`
 * for the timeline itself — only RunHistory does), but the assertion
 * here is the safety net that flags a regression if the cold render
 * ever grows above ~3s under jsdom (~10–15× faster in a real browser).
 *
 * If/when EventTimeline adopts virtualization, tighten the budget.
 */

const BASE_EVENT = {
  schema_version: 1 as const,
  agent_id: "agent-bench",
  run_id: "run-bench-timeline",
  occurred_at: "2026-05-23T00:00:00.000Z",
  received_at: "2026-05-23T00:00:00.000Z",
};

function assistantFrame(seq: number): ServerFrame {
  return {
    id: `bench-timeline-frame-${seq.toString()}`,
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

describe("EventTimeline render perf", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("cold-renders a timeline pre-seeded with 10,000 events within the loose budget", () => {
    useRunStore.setState({ byId: {}, eventsByRunId: {}, activeRunId: null });
    // Seed by replaying 10k ingests so the store's internal projections
    // (assistantText, toolCallCount) match the production code path.
    act(() => {
      for (let i = 1; i <= 10_000; i += 1) {
        useRunStore.getState().ingestServerFrame(assistantFrame(i));
      }
    });

    const mountStart = performance.now();
    render(createElement(EventTimeline, { runId: BASE_EVENT.run_id }));
    const mountElapsed = performance.now() - mountStart;
    // eslint-disable-next-line no-console -- intentional readable benchmark output.
    console.info(`[bench] EventTimeline cold mount with 10k events = ${mountElapsed.toFixed(1)}ms`);

    // Loose budget: jsdom mount of 10k events under non-virtualized
    // tree should still finish under 3 seconds. If virtualization lands
    // for EventTimeline, tighten to <500ms.
    expect(mountElapsed).toBeLessThan(3_000);
  });
});
