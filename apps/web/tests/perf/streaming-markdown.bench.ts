import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingMarkdown } from "../../src/components/streaming/StreamingMarkdown.js";
import { useRunStore } from "../../src/state/run-store.js";

function seedMountedRun(runId: string): void {
  useRunStore.setState({
    byId: {
      [runId]: {
        id: runId,
        agentId: "agent-bench",
        status: "RUNNING",
        startedAt: null,
        finishedAt: null,
        finalText: null,
        interruptedReason: null,
        usage: null,
        usageSource: null,
        durationMs: null,
      },
    },
    eventsByRunId: {
      [runId]: {
        seqList: [],
        bySeq: new Map(),
        events: [],
        lastSeq: 0,
        assistantText: "",
        thinkingText: "",
        toolCallCount: 0,
      },
    },
    activeRunId: runId,
  });
}

function updateAssistantText(runId: string, text: string): void {
  useRunStore.setState((state) => {
    const existing = state.eventsByRunId[runId];
    if (!existing) return state;
    return {
      ...state,
      eventsByRunId: {
        ...state.eventsByRunId,
        [runId]: { ...existing, assistantText: text },
      },
    };
  });
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

function makeMarkdownStream(): string[] {
  const chunks: string[] = [];
  chunks.push("# Streaming benchmark\n\n");
  for (let i = 0; i < 160; i += 1) {
    chunks.push(`Paragraph ${i.toString()} starts with a coding-agent explanation `);
    for (let j = 0; j < 25; j += 1) chunks.push(`token-${i.toString()}-${j.toString()} `);
    chunks.push("\n\n");
    if (i % 20 === 0) chunks.push(`- item ${i.toString()}\n- item ${(i + 1).toString()}\n\n`);
    if (i % 40 === 0) chunks.push("```ts\nconst value = 1;\n```\n\n");
  }
  return chunks;
}

describe("streaming markdown perf", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps mounted block-boundary and prose updates inside the Phase 09 budget", () => {
    const runId = "bench-mounted-md";
    seedMountedRun(runId);
    render(createElement(StreamingMarkdown, { runId, source: "assistant" }));
    const structuralTimes: number[] = [];
    const proseTimes: number[] = [];
    let text = "";

    for (const chunk of makeMarkdownStream()) {
      text += chunk;
      const start = performance.now();
      act(() => updateAssistantText(runId, text));
      const elapsed = performance.now() - start;
      if (chunk.includes("\n")) structuralTimes.push(elapsed);
      else proseTimes.push(elapsed);
    }

    const structuralP50 = percentile(structuralTimes, 0.5);
    const proseP50 = percentile(proseTimes, 0.5);
    console.info(
      `[bench] mounted streaming markdown block-boundary p50=${structuralP50.toFixed(3)}ms prose p50=${proseP50.toFixed(3)}ms`,
    );

    expect(structuralP50).toBeLessThan(12);
    expect(proseP50).toBeLessThan(4);
  });
});
