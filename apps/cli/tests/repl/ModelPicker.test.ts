import { describe, expect, it } from "vitest";
import { moveModelSelection, modelPickerWindow, type ModelPickerRow } from "../../src/repl/ModelPicker.js";

function rows(n: number): ModelPickerRow[] {
  return Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: `Model ${i}`, provider: "cursor" }));
}

describe("moveModelSelection", () => {
  it("wraps around both ends", () => {
    expect(moveModelSelection(0, -1, 3)).toBe(2);
    expect(moveModelSelection(2, 1, 3)).toBe(0);
    expect(moveModelSelection(1, 1, 3)).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(moveModelSelection(0, 1, 0)).toBe(0);
  });
});

describe("modelPickerWindow", () => {
  it("returns all rows when they fit the window", () => {
    const all = rows(5);
    const view = modelPickerWindow(all, 2, 8);
    expect(view.start).toBe(0);
    expect(view.rows).toHaveLength(5);
  });

  it("scrolls to keep the selection visible, clamped at the end", () => {
    const all = rows(20);
    const top = modelPickerWindow(all, 0, 8);
    expect(top.start).toBe(0);

    const mid = modelPickerWindow(all, 10, 8);
    expect(mid.start).toBe(7); // selectedIndex - 3
    expect(mid.rows[0]?.id).toBe("m7");

    const end = modelPickerWindow(all, 19, 8);
    expect(end.start).toBe(12); // clamped to length - window
    expect(end.rows.at(-1)?.id).toBe("m19");
  });
});
