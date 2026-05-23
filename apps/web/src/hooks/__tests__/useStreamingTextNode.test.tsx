import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamingTextNode } from "../useStreamingTextNode.js";

function Probe(props: { text: string; isReplacement?: boolean; streamId?: string }) {
  const ref = useStreamingTextNode({
    text: props.text,
    isReplacement: props.isReplacement ?? false,
    streamId: props.streamId,
  });
  return <span data-testid="stream" ref={ref} />;
}

describe("useStreamingTextNode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      return window.setTimeout(() => cb(performance.now()), 16);
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps one text node and appends only the unseen suffix", () => {
    const view = render(<Probe text="Hello" />);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    const span = view.getByTestId("stream");
    const firstTextNode = span.firstChild;

    view.rerender(<Probe text="Hello world" />);
    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(span.textContent).toBe("Hello world");
    expect(span.childNodes).toHaveLength(1);
    expect(span.firstChild).toBe(firstTextNode);
  });

  it("replaces the text when the stream reports a replacement", () => {
    const view = render(<Probe text="draft" />);
    act(() => {
      vi.advanceTimersByTime(16);
    });

    view.rerender(<Probe text="final" isReplacement />);
    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(view.getByTestId("stream").textContent).toBe("final");
  });
});
