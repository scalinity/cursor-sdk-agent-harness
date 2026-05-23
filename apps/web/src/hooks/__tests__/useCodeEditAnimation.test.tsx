import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCodeEditAnimation } from "../useCodeEditAnimation.js";

interface RafEntry {
  id: number;
  callback: FrameRequestCallback;
}

let rafQueue: RafEntry[] = [];
let rafId = 0;

function installRaf() {
  rafQueue = [];
  rafId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    rafId += 1;
    rafQueue.push({ id: rafId, callback });
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafQueue = rafQueue.filter((entry) => entry.id !== id);
  });
}

function flushRaf(time: number) {
  const next = rafQueue.shift();
  if (!next) throw new Error("No RAF callback queued");
  act(() => next.callback(time));
}

function Harness(props: { charsPerSecond: number; totalLength?: number; enabled?: boolean }) {
  const animation = useCodeEditAnimation({
    eventId: "evt-1",
    chunks: [{ path: "src/demo.ts", startOffset: 0, insertText: "abcdef" }],
    enabled: props.enabled ?? true,
    charsPerSecond: props.charsPerSecond,
    totalLength: props.totalLength ?? 6,
  });
  return (
    <output data-complete={animation.isComplete ? "yes" : "no"}>
      {animation.visibleBuffersByPath["src/demo.ts"] ?? ""}:{animation.caretOffsetByPath["src/demo.ts"] ?? 0}
    </output>
  );
}

function ReplaceHarness(props: { charsPerSecond: number }) {
  const animation = useCodeEditAnimation({
    eventId: "evt-replace",
    chunks: [
      {
        path: "src/demo.ts",
        startOffset: 15,
        deleteText: "41",
        insertText: "42",
        initialText: "const answer = 41;\n",
      },
    ],
    enabled: true,
    charsPerSecond: props.charsPerSecond,
    totalLength: 2,
  });
  return <output>{animation.visibleBuffersByPath["src/demo.ts"] ?? ""}</output>;
}

describe("useCodeEditAnimation", () => {
  beforeEach(() => installRaf());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reveals characters in RAF-paced batches", () => {
    render(<Harness charsPerSecond={120} />);

    flushRaf(0);
    flushRaf(17);
    expect(screen.getByText("ab:2")).not.toBeNull();
  });

  it("applies seeded replace chunks without losing the surrounding buffer", () => {
    render(<ReplaceHarness charsPerSecond={120} />);

    expect(screen.getByText("const answer = 41;")).not.toBeNull();
    flushRaf(0);
    flushRaf(17);
    expect(screen.getByText("const answer = 42;")).not.toBeNull();
  });

  it("does not restart visible text when replay speed changes", () => {
    const { rerender } = render(<Harness charsPerSecond={120} />);

    flushRaf(0);
    flushRaf(17);
    expect(screen.getByText("ab:2")).not.toBeNull();

    rerender(<Harness charsPerSecond={480} />);
    expect(screen.getByText("ab:2")).not.toBeNull();
  });

  it("renders instantly when charsPerSecond is Infinity", async () => {
    render(<Harness charsPerSecond={Infinity} />);
    await waitFor(() => expect(screen.getByText("abcdef:6")).not.toBeNull());
    expect(screen.getByText("abcdef:6").dataset.complete).toBe("yes");
  });

  it("skips per-character animation for large edits", async () => {
    render(<Harness charsPerSecond={120} totalLength={50_000} />);
    await waitFor(() => expect(screen.getByText("abcdef:6")).not.toBeNull());
  });
});
