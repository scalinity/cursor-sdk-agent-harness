import { describe, expect, it } from "vitest";
import {
  deriveChromeState,
  formatThinkingGradientSegments,
  formatThinkingIndicatorText,
  formatTurnClock,
  thinkingGradientPeakIndex,
} from "../../src/repl/App.js";
import { THINKING_DOT_FRAME_HOLD } from "../../src/repl/useSpinnerFrame.js";

describe("App turn formatting", () => {
  it("formats the turn clock as HH:MM in local time", () => {
    expect(formatTurnClock(new Date(2026, 4, 27, 14, 32))).toBe("14:32");
    expect(formatTurnClock(new Date(2026, 0, 1, 9, 5))).toBe("09:05");
  });

  it("animates the thinking indicator text with stable width and slower dots", () => {
    expect(formatThinkingIndicatorText(0)).toBe("Thinking   ");
    expect(formatThinkingIndicatorText(THINKING_DOT_FRAME_HOLD - 1)).toBe("Thinking   ");
    expect(formatThinkingIndicatorText(THINKING_DOT_FRAME_HOLD)).toBe("Thinking.  ");
    expect(formatThinkingIndicatorText(THINKING_DOT_FRAME_HOLD * 2 - 1)).toBe("Thinking.  ");
    expect(formatThinkingIndicatorText(THINKING_DOT_FRAME_HOLD * 2)).toBe("Thinking.. ");
    expect(formatThinkingIndicatorText(THINKING_DOT_FRAME_HOLD * 3)).toBe("Thinking...");
  });

  it("moves the thinking gradient peak back and forth across the word", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((frame) => thinkingGradientPeakIndex(frame, 4))).toEqual([
      0,
      1,
      2,
      3,
      2,
      1,
      0,
    ]);
  });

  it("formats a fade gradient around the active thinking character", () => {
    const segments = formatThinkingGradientSegments("Thinking...", 2, {
      dim: "dim",
      mid: "mid",
      bright: "bright",
    });

    expect(segments.map((segment) => segment.text).join("")).toBe("Thinking...");
    expect(segments.slice(0, 5).map((segment) => segment.color)).toEqual([
      "dim",
      "mid",
      "bright",
      "mid",
      "dim",
    ]);
  });
});

describe("deriveChromeState", () => {
  it("does not show ready while a terminal status is still settling", () => {
    expect(deriveChromeState({ streamStatus: "ready", turnActive: false, busy: true, toolRunning: false })).toBe("streaming");
  });

  it("prioritizes tool-running and disconnected states", () => {
    expect(deriveChromeState({ streamStatus: "connected", turnActive: true, busy: true, toolRunning: true })).toBe("tool-running");
    expect(deriveChromeState({ streamStatus: "disconnected", turnActive: true, busy: true, toolRunning: true })).toBe("disconnected");
  });

  it("shows error after a completed turn appends an error item", () => {
    expect(deriveChromeState({ streamStatus: "ready", turnActive: false, busy: false, toolRunning: false, lastItemType: "error" })).toBe("error");
  });
});
