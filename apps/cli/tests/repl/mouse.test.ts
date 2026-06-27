import { describe, expect, it } from "vitest";
import { parseMouseWheel } from "../../src/repl/mouse.js";

// Ink strips the leading ESC before handing input to `useInput`, so the SGR
// reports below are written without it — matching what the REPL actually sees.
describe("parseMouseWheel", () => {
  it("returns null for ordinary text", () => {
    expect(parseMouseWheel("hello")).toBeNull();
    expect(parseMouseWheel("")).toBeNull();
    expect(parseMouseWheel("/model")).toBeNull();
    // Bracketed text that is not a mouse report stays text.
    expect(parseMouseWheel("[draft]")).toBeNull();
  });

  it("reads a wheel-up notch as scrolling toward older content", () => {
    expect(parseMouseWheel("[<64;10;5M")).toEqual({ notches: 1 });
  });

  it("reads a wheel-down notch as scrolling toward newer content", () => {
    expect(parseMouseWheel("[<65;10;5M")).toEqual({ notches: -1 });
  });

  it("masks modifier bits so shift/ctrl wheel still scrolls", () => {
    // 64 + 4 (shift) = 68 → still wheel-up; 65 + 16 (ctrl) = 81 → still wheel-down.
    expect(parseMouseWheel("[<68;1;1M")).toEqual({ notches: 1 });
    expect(parseMouseWheel("[<81;1;1M")).toEqual({ notches: -1 });
  });

  it("sums batched notches arriving in one chunk", () => {
    expect(parseMouseWheel("[<64;1;1M[<64;1;1M[<64;1;1M")).toEqual({ notches: 3 });
    expect(parseMouseWheel("[<64;1;1M[<65;1;1M")).toEqual({ notches: 0 });
  });

  it("recognizes clicks as mouse events with no scroll", () => {
    // Button 0 press/release: a mouse event we must swallow, but zero notches.
    expect(parseMouseWheel("[<0;3;4M")).toEqual({ notches: 0 });
    expect(parseMouseWheel("[<0;3;4m")).toEqual({ notches: 0 });
  });

  it("ignores horizontal wheel tilt", () => {
    // Buttons 66/67 are left/right tilt — recognized but not vertical scroll.
    expect(parseMouseWheel("[<66;1;1M")).toEqual({ notches: 0 });
    expect(parseMouseWheel("[<67;1;1M")).toEqual({ notches: 0 });
  });

  it("swallows legacy X10 reports without inferring direction", () => {
    expect(parseMouseWheel("[M abc")).toEqual({ notches: 0 });
  });
});
