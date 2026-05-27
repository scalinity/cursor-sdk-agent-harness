import { describe, expect, it } from "vitest";
import { formatStatusBar } from "../../src/repl/StatusBar.js";

describe("StatusBar helpers", () => {
  it("keeps chrome ownership narrow and labels session totals", () => {
    const output = formatStatusBar({
      sessionCost: { micros: 0, hasUnavailableTurn: false },
      sessionTokens: { tokens: 0, hasUnavailableTurn: false },
    });

    expect(output).toContain("total 0 tok · $0.00");
    expect(output).not.toContain("ws");
    expect(output).not.toContain("ready");
    expect(output).not.toContain("dir:");
  });

  it("marks session cost unavailable when a completed turn has no cost", () => {
    const output = formatStatusBar({
      sessionCost: { micros: 0, hasUnavailableTurn: true },
      sessionTokens: { tokens: 0, hasUnavailableTurn: false },
    });

    expect(output).toContain("total 0 tok · cost unavailable");
  });

  it("marks session cost partial when some completed turns have no cost", () => {
    const output = formatStatusBar({
      sessionCost: { micros: 100_000, hasUnavailableTurn: true },
      sessionTokens: { tokens: 0, hasUnavailableTurn: false },
    });

    expect(output).toContain("total 0 tok · partial $0.10");
  });

  it("shows cumulative token and cost totals without turn usage chrome", () => {
    const output = formatStatusBar({
      sessionCost: { micros: 26_900, hasUnavailableTurn: false },
      sessionTokens: { tokens: 10_292, hasUnavailableTurn: false },
    });

    expect(output).toContain("total 10,292 tok · $0.0269");
    expect(output).not.toContain("turn usage");
  });

  it("marks token totals partial when some completed turns have unavailable tokens", () => {
    const output = formatStatusBar({
      sessionCost: { micros: 900, hasUnavailableTurn: false },
      sessionTokens: { tokens: 300, hasUnavailableTurn: true },
    });

    expect(output).toContain("total partial 300 tok · $0.0009");
  });

  it("formats status hints based on scroll mode", () => {
    const wide = { width: 220, sessionCost: { micros: 0, hasUnavailableTurn: false }, sessionTokens: { tokens: 0, hasUnavailableTurn: false } };
    const scrollable = formatStatusBar({ ...wide, streamScrollActive: true });
    expect(scrollable).toContain("Ctrl+G latest");
    const promptHistory = formatStatusBar({ ...wide, streamScrollActive: false });
    expect(promptHistory).toContain("↑↓ prompt history");
    const compact = formatStatusBar({ sessionCost: { micros: 0, hasUnavailableTurn: false }, sessionTokens: { tokens: 0, hasUnavailableTurn: false }, streamScrollActive: false, width: 80 });
    expect(compact).toContain("↑↓ prompts");
  });
});
