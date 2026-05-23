import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CanonicalRunEvent,
  RunEventState,
} from "../../src/state/run-store.js";
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
 *
 * P14-S12: pre-seed via `useRunStore.setState` with a hand-built
 * RunEventState. Previously called `ingestServerFrame` 10k times inside
 * an `act(...)`, which conflated the cold-mount cost with 10k subscriber
 * notifications. Direct setState lets the bench measure just the
 * EventTimeline render path.
 */

const RUN_ID = "run-bench-timeline";
const AGENT_ID = "agent-bench";
const TIMESTAMP = "2026-05-23T00:00:00.000Z";
const TOTAL = 10_000;

function buildSeededEventState(total: number): RunEventState {
  const events: CanonicalRunEvent[] = [];
  const bySeq = new Map<number, CanonicalRunEvent>();
  const seqList: number[] = [];
  let assistantText = "";
  for (let seq = 1; seq <= total; seq += 1) {
    const delta = `token-${seq.toString()} `;
    assistantText += delta;
    const ev: CanonicalRunEvent = {
      event_id: `00000000-0000-0000-0000-${seq.toString().padStart(12, "0")}`,
      schema_version: 1,
      seq,
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      occurred_at: TIMESTAMP,
      received_at: TIMESTAMP,
      sdk_type: "assistant",
      kind: "assistant.delta",
      payload: {
        role: "assistant",
        text_delta: delta,
        is_replacement: false,
        tool_uses: [],
      },
    };
    events.push(ev);
    bySeq.set(seq, ev);
    seqList.push(seq);
  }
  return {
    seqList,
    bySeq,
    events,
    lastSeq: total,
    assistantText,
    thinkingText: "",
    toolCallCount: 0,
    approvalsByRequestId: {},
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
    // Pre-seed via direct setState so the bench measures only the
    // React render path, not 10k subscriber notifications.
    useRunStore.setState({
      byId: {
        [RUN_ID]: {
          id: RUN_ID,
          agentId: AGENT_ID,
          status: "RUNNING",
          startedAt: TIMESTAMP,
          finishedAt: null,
          finalText: null,
          interruptedReason: null,
          usage: null,
          usageSource: null,
          durationMs: null,
        },
      },
      eventsByRunId: {
        [RUN_ID]: buildSeededEventState(TOTAL),
      },
      activeRunId: RUN_ID,
    });

    const mountStart = performance.now();
    render(createElement(EventTimeline, { runId: RUN_ID }));
    const mountElapsed = performance.now() - mountStart;
    console.info(`[bench] EventTimeline cold mount with 10k events = ${mountElapsed.toFixed(1)}ms`);

    // Loose budget: jsdom mount of 10k events under non-virtualized
    // tree should still finish under 3 seconds. If virtualization lands
    // for EventTimeline, tighten to <500ms.
    expect(mountElapsed).toBeLessThan(3_000);
  });
});
