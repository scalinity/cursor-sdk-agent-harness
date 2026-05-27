import { describe, expect, it } from "vitest";
import { formatTurnClock } from "../../src/repl/App.js";

describe("App turn formatting", () => {
  it("formats the turn clock as HH:MM in local time", () => {
    expect(formatTurnClock(new Date(2026, 4, 27, 14, 32))).toBe("14:32");
    expect(formatTurnClock(new Date(2026, 0, 1, 9, 5))).toBe("09:05");
  });
});
