import { describe, expect, it } from "vitest";
import {
  addSessionCost,
  addSessionTokens,
  deriveChromeState,
  formatThinkingGradientSegments,
  formatThinkingIndicatorText,
  formatTurnClock,
  markSessionCostUnavailable,
  markSessionTokensUnavailable,
  thinkingGradientPeakIndex,
} from "../../src/repl/App.js";
import type { TokenUsage } from "@harness/shared";
import { THINKING_DOT_FRAME_HOLD, formatThinkingSpinnerFrame } from "../../src/repl/useSpinnerFrame.js";

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

  it("animates the thinking spinner glyph on every frame", () => {
    expect([0, 1, 2, 3].map(formatThinkingSpinnerFrame)).toEqual([
      "⠋",
      "⠙",
      "⠹",
      "⠸",
    ]);
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

describe("session counter accumulation", () => {
  const fullUsage: TokenUsage = {
    input_tokens: 10,
    output_tokens: 20,
    cached_input_tokens: 0,
    reasoning_tokens: null,
    cost_usd_micros: 2500,
    usage_source: "sdk_final_result",
  };

  it("adds exact token and cost totals from complete final usage", () => {
    expect(addSessionTokens({ tokens: 100, hasUnavailableTurn: false }, fullUsage)).toEqual({
      tokens: 130,
      hasUnavailableTurn: false,
    });
    expect(addSessionCost({ micros: 1000, hasUnavailableTurn: false }, fullUsage)).toEqual({
      micros: 3500,
      hasUnavailableTurn: false,
    });
  });

  it("marks counters partial when final usage omits part of the token or cost total", () => {
    const partialUsage: TokenUsage = {
      input_tokens: 10,
      output_tokens: null,
      cached_input_tokens: null,
      reasoning_tokens: null,
      cost_usd_micros: null,
      usage_source: "sdk_final_result",
    };

    expect(addSessionTokens({ tokens: 100, hasUnavailableTurn: false }, partialUsage)).toEqual({
      tokens: 110,
      hasUnavailableTurn: true,
    });
    expect(addSessionCost({ micros: 1000, hasUnavailableTurn: false }, partialUsage)).toEqual({
      micros: 1000,
      hasUnavailableTurn: true,
    });
  });

  it("marks counters partial when a run interrupts before final usage", () => {
    expect(markSessionTokensUnavailable({ tokens: 100, hasUnavailableTurn: false })).toEqual({
      tokens: 100,
      hasUnavailableTurn: true,
    });
    expect(markSessionCostUnavailable({ micros: 1000, hasUnavailableTurn: false })).toEqual({
      micros: 1000,
      hasUnavailableTurn: true,
    });
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
