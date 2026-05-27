import { describe, expect, it } from "vitest";
import {
  applyStreamScrollDelta,
  computeStreamViewportLayout,
  formatStreamScrollHints,
  resolveStreamScrollDelta,
  shouldReserveArrowKeysForStreamScroll,
  shouldUseCtrlForPromptHistory,
  streamScrollPageStep,
} from "../../src/repl/stream-scroll.js";

describe("stream scroll helpers", () => {
  const items = [{ type: "system" as const, text: "one\ntwo\nthree\nfour\nfive\nsix" }];

  it("computes viewport layout and clamps stale offsets", () => {
    const layout = computeStreamViewportLayout(items, 20, 2, 99);
    expect(layout.maxOffset).toBeGreaterThan(0);
    expect(layout.effectiveOffset).toBe(layout.maxOffset);
    expect(layout.streamScrollActive).toBe(true);
  });

  it("does not mark exact-fit transcripts as scrollable", () => {
    const exact = [{ type: "system" as const, text: "one\ntwo" }];
    const layout = computeStreamViewportLayout(exact, 20, 2, 0);

    expect(layout.maxOffset).toBe(0);
    expect(layout.effectiveOffset).toBe(0);
    expect(layout.bodyHeight).toBe(2);
    expect(layout.streamScrollActive).toBe(false);
  });

  it("resolves arrow, page, and jump-to-latest scroll deltas", () => {
    const layout = { bodyHeight: 10, maxOffset: 20 };
    expect(resolveStreamScrollDelta({ upArrow: true }, layout, 3)).toBe(1);
    expect(resolveStreamScrollDelta({ downArrow: true, shift: true }, layout, 10)).toBe(-5);
    expect(resolveStreamScrollDelta({ pageUp: true }, layout, 0)).toBe(streamScrollPageStep(10));
    expect(resolveStreamScrollDelta({ ctrl: true, input: "g" }, layout, 8)).toBe(-8);
    expect(resolveStreamScrollDelta({ ctrl: true, upArrow: true }, layout, 0)).toBeNull();
  });

  it("ignores scroll keys when there is no scrollable overflow", () => {
    const layout = { bodyHeight: 10, maxOffset: 0 };
    expect(resolveStreamScrollDelta({ upArrow: true }, layout, 0)).toBeNull();
    expect(resolveStreamScrollDelta({ pageDown: true }, layout, 0)).toBeNull();
    expect(resolveStreamScrollDelta({ ctrl: true, input: "g" }, layout, 2)).toBe(-2);
  });

  it("applies scroll deltas within bounds", () => {
    expect(applyStreamScrollDelta(2, 5, 10)).toBe(7);
    expect(applyStreamScrollDelta(2, -5, 10)).toBe(0);
    expect(applyStreamScrollDelta(4, 10, 6)).toBe(6);
  });

  it("delegates prompt-history keys only when the stream is not scrollable", () => {
    expect(shouldReserveArrowKeysForStreamScroll(true)).toBe(true);
    expect(shouldUseCtrlForPromptHistory(true)).toBe(true);
    expect(shouldReserveArrowKeysForStreamScroll(false)).toBe(false);
    expect(shouldUseCtrlForPromptHistory(false)).toBe(false);
  });

  it("formats status hints for scrollable and prompt-history modes", () => {
    expect(formatStreamScrollHints(true, false)).toContain("Ctrl+G latest");
    expect(formatStreamScrollHints(true, false)).toContain("Ctrl+↑↓ prompt history");
    expect(formatStreamScrollHints(false, false)).toContain("↑↓ prompt history");
    expect(formatStreamScrollHints(false, true)).toContain("↑↓ prompts");
  });
});
