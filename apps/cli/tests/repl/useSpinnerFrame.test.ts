import { describe, expect, it } from "vitest";
import {
  THINKING_DOT_FRAME_HOLD,
  THINKING_SPINNER_FRAME_COUNT,
  THINKING_SPINNER_FRAMES,
  formatThinkingIndicatorText,
  formatThinkingSpinnerFrame,
} from "../../src/repl/useSpinnerFrame.js";

const THINKING_DOT_PHASE_COUNT = 4;
const THINKING_CYCLE_LENGTH = THINKING_DOT_FRAME_HOLD * THINKING_DOT_PHASE_COUNT;

describe("formatThinkingSpinnerFrame", () => {
  it("cycles Braille dot frames instead of staying static", () => {
    expect(formatThinkingSpinnerFrame(0)).toBe("⠋");
    expect(formatThinkingSpinnerFrame(1)).not.toBe(formatThinkingSpinnerFrame(0));
    expect([0, 1, 2, 3].map(formatThinkingSpinnerFrame)).toEqual(["⠋", "⠙", "⠹", "⠸"]);
    expect(formatThinkingSpinnerFrame(THINKING_SPINNER_FRAME_COUNT)).toBe("⠋");
  });

  it("does not freeze on a single glyph across the spinner frame window", () => {
    const frames = new Set(
      Array.from({ length: THINKING_SPINNER_FRAME_COUNT }, (_, index) => formatThinkingSpinnerFrame(index)),
    );
    expect(frames.size).toBe(THINKING_SPINNER_FRAME_COUNT);
  });
});

describe("thinking indicator cycle", () => {
  it("advances the spinner every tick and dot text every hold window", () => {
    for (let index = 0; index < THINKING_CYCLE_LENGTH; index += 1) {
      expect(formatThinkingSpinnerFrame(index)).toBe(
        THINKING_SPINNER_FRAMES[index % THINKING_SPINNER_FRAME_COUNT],
      );
      const phase = Math.floor(index / THINKING_DOT_FRAME_HOLD);
      expect(formatThinkingIndicatorText(index)).toBe(
        ["Thinking   ", "Thinking.  ", "Thinking.. ", "Thinking..."][phase],
      );
    }
  });
});
