/**
 * useSpeechToText smoke — under jsdom the browser media/worker APIs are
 * absent, so the hook must report `supported: false` and treat `toggle()` as
 * an inert no-op (never constructing a worker or touching getUserMedia). This
 * guards the feature-detection path that keeps the composer renderable in the
 * test environment and degrades gracefully where dictation can't run.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpeechToText } from "../useSpeechToText.js";

describe("useSpeechToText", () => {
  it("reports unsupported and stays idle under jsdom", () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechToText({ onTranscript }));

    expect(result.current.supported).toBe(false);
    expect(result.current.status).toBe("idle");
    expect(result.current.isRecording).toBe(false);
    expect(result.current.modelProgress).toBeNull();
  });

  it("toggle is a no-op when unsupported (does not throw or record)", () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechToText({ onTranscript }));

    act(() => result.current.toggle());

    expect(result.current.status).toBe("idle");
    expect(result.current.isRecording).toBe(false);
    expect(onTranscript).not.toHaveBeenCalled();
  });
});
