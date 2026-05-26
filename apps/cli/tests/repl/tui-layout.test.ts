import { describe, expect, it } from "vitest";
import { computeTuiLayout } from "../../src/repl/layout.js";
import { filterSlashCommands } from "../../src/repl/SlashPalette.js";
import { renderViewportLines } from "../../src/repl/StreamView.js";
import { bg, border, createTuiTheme, fg } from "../../src/repl/theme.js";

describe("fullscreen TUI helpers", () => {
  it("refuses terminals below the documented minimum", () => {
    expect(computeTuiLayout({ columns: 40, rows: 10 }, 1, 0).canRender).toBe(false);
    expect(computeTuiLayout({ columns: 200, rows: 60 }, 3, 6).scrollHeight).toBeGreaterThan(40);
  });

  it("filters slash commands by typed prefix", () => {
    expect(filterSlashCommands("/mo").map((item) => item.command)).toEqual(["mode", "model"]);
    expect(filterSlashCommands("hello")).toEqual([]);
  });

  it("wraps and scrolls viewport text deterministically", () => {
    const lines = renderViewportLines("alpha beta gamma delta\nlast", 10, 2, 0);
    expect(lines).toEqual(["delta", "last"]);
    expect(renderViewportLines("one\ntwo\nthree", 20, 2, 1)).toEqual(["one", "two"]);
  });

  it("omits Ink color props in NO_COLOR mode", () => {
    const theme = createTuiTheme({ NO_COLOR: "1" });
    expect(fg(theme.accent)).toEqual({});
    expect(bg(theme.panel)).toEqual({});
    expect(border(theme.border)).toEqual({});
  });
});
