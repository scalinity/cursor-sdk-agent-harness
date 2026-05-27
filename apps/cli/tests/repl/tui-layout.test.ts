import { describe, expect, it } from "vitest";
import { computeTuiLayout, countInputLines, MAX_INPUT_VISIBLE_LINES } from "../../src/repl/layout.js";
import { filterSlashCommands } from "../../src/repl/SlashPalette.js";
import { clampStreamScrollOffset, computeActiveLabelSpacerHeight, formatScrollIndicator, formatTurnHeader, maxStreamScrollOffset, renderViewportLines } from "../../src/repl/StreamView.js";
import { bg, border, createTuiTheme, fg } from "../../src/repl/theme.js";

describe("fullscreen TUI helpers", () => {
  it("refuses terminals below the documented minimum", () => {
    expect(computeTuiLayout({ columns: 40, rows: 10 }, 1, 0).canRender).toBe(false);
    expect(computeTuiLayout({ columns: 200, rows: 60 }, 3, 6).scrollHeight).toBeGreaterThan(40);
  });

  it("filters slash commands by typed prefix", () => {
    expect(filterSlashCommands("/mo").map((item) => item.command)).toEqual(["mode", "model"]);
    expect(filterSlashCommands("/mode ask")).toEqual([]);
    expect(filterSlashCommands("hello")).toEqual([]);
  });

  it("reserves bounded input height from wrapped visual rows", () => {
    const lineCount = countInputLines("x".repeat(500), 60);
    expect(lineCount).toBeGreaterThan(MAX_INPUT_VISIBLE_LINES);
    expect(computeTuiLayout({ columns: 60, rows: 24 }, lineCount, 0).inputHeight).toBe(MAX_INPUT_VISIBLE_LINES + 2);
  });

  it("wraps and scrolls viewport text deterministically", () => {
    const lines = renderViewportLines("alpha beta gamma delta\nlast", 10, 2, 0);
    expect(lines).toEqual(["delta", "last"]);
    expect(renderViewportLines("one\ntwo\nthree", 20, 2, 1)).toEqual(["one", "two"]);
    // 3 content lines, height 2, offset 99 → indicator takes 1 line → bodyHeight=1 → max=2.
    // Uses a system item (no turn header) so the math isn't confounded by a ── claude ── line.
    expect(clampStreamScrollOffset([{ type: "system", text: "one\ntwo\nthree" }], 20, 2, 99)).toBe(2);
  });

  it("treats an empty buffer as non-scrollable", () => {
    // After /clear a stale offset must collapse to 0 so no "lines below" indicator renders.
    expect(maxStreamScrollOffset([], 40, 5)).toBe(0);
    expect(clampStreamScrollOffset([], 40, 5, 99)).toBe(0);
    expect(clampStreamScrollOffset([{ type: "assistant", text: "" }], 40, 5, 99)).toBe(0);
  });

  it("keeps the active indicator at the bottom of sparse chat viewports", () => {
    expect(computeActiveLabelSpacerHeight(1, 5)).toBe(4);
    expect(computeActiveLabelSpacerHeight(0, 5)).toBe(4);
    expect(computeActiveLabelSpacerHeight(5, 5)).toBe(0);
    expect(computeActiveLabelSpacerHeight(8, 5)).toBe(0);
  });

  it("keeps the scroll indicator within one row", () => {
    const wide = formatScrollIndicator(3, 60);
    expect(wide).toContain("lines below");
    expect(wide.length).toBeLessThanOrEqual(60);
    expect(formatScrollIndicator(5, 20)).toBe("▼ 5 below");
    expect(formatScrollIndicator(99999, 40).length).toBeLessThanOrEqual(40);
    expect(formatScrollIndicator(999999999, 12).length).toBeLessThanOrEqual(12);
  });

  it("renders turn headers as a full-width separator with a timestamp and a short sub-label without", () => {
    const youHeader = formatTurnHeader("you", 30, "14:32");
    expect(youHeader.startsWith("── you · 14:32 ")).toBe(true);
    expect(youHeader.length).toBe(30);
    expect(formatTurnHeader("claude", 30)).toBe("── claude ──");
  });

  it("omits Ink color props in NO_COLOR mode", () => {
    const theme = createTuiTheme({ NO_COLOR: "1" });
    expect(fg(theme.brand)).toEqual({});
    expect(bg(theme.panel)).toEqual({});
    expect(border(theme.border)).toEqual({});
  });

  it("keeps default surfaces transparent so terminal profiles do not become gray slabs", () => {
    const theme = createTuiTheme({});
    expect(bg(theme.background)).toEqual({});
    expect(bg(theme.panel)).toEqual({});
    expect(bg(theme.panelSoft)).toEqual({});
    expect(fg(theme.brand)).toEqual({ color: "#E04E1F" });
    expect(border(theme.border)).toEqual({ borderColor: "#66717f" });
  });
});
