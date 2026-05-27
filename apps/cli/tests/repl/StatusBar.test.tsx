import { describe, expect, it } from "vitest";
import { formatStatusBar } from "../../src/repl/StatusBar.js";

describe("StatusBar helpers", () => {
  it("keeps chrome ownership narrow and labels session cost", () => {
    const output = formatStatusBar({
      sessionCost: { micros: 0, hasUnavailableTurn: false },
    });

    expect(output).toContain("session $0.00");
    expect(output).not.toContain("ws");
    expect(output).not.toContain("ready");
    expect(output).not.toContain("dir:");
  });

  it("marks session cost unavailable when a completed turn has no cost", () => {
    const output = formatStatusBar({
      sessionCost: { micros: 0, hasUnavailableTurn: true },
    });

    expect(output).toContain("session unavailable");
  });

  it("marks session cost partial when some completed turns have no cost", () => {
    const output = formatStatusBar({
      sessionCost: { micros: 100_000, hasUnavailableTurn: true },
    });

    expect(output).toContain("session partial $0.10");
  });

  it("shows explicit unavailable live turn usage without estimating", () => {
    const output = formatStatusBar({
      sessionCost: { micros: 900, hasUnavailableTurn: false },
      turnUsage: { status: "unavailable" },
    });

    expect(output).toContain("turn usage unavailable");
    expect(output).toContain("session $0.0009");
  });

  it("formats status hints based on scroll mode", () => {
    const wide = { width: 140, sessionCost: { micros: 0, hasUnavailableTurn: false } };
    const scrollable = formatStatusBar({ ...wide, streamScrollActive: true });
    expect(scrollable).toContain("Ctrl+G latest");
    const promptHistory = formatStatusBar({ ...wide, streamScrollActive: false });
    expect(promptHistory).toContain("↑↓ prompt history");
    const compact = formatStatusBar({ sessionCost: { micros: 0, hasUnavailableTurn: false }, streamScrollActive: false, width: 80 });
    expect(compact).toContain("↑↓ prompts");
  });
});
