import { describe, expect, it } from "vitest";
import { createStyles } from "../../src/render/styles.js";

describe("createStyles", () => {
  it("is identity for every token in NO_COLOR mode", () => {
    const s = createStyles({ noColor: true });
    expect(s.error("boom")).toBe("boom");
    expect(s.tool("read x")).toBe("read x");
    expect(s.diffAdd("+a")).toBe("+a");
    expect(s.thinking("hmm")).toBe("hmm");
    expect(s.match("hit")).toBe("hit");
    expect(s.user("you")).toBe("you");
  });

  it("preserves the wrapped text when colors are enabled", () => {
    const s = createStyles({
      noColor: false,
      text: "#eef2f7",
      muted: "#9aa3ad",
      accent: "#9bd7d8",
      warning: "#f2c94c",
      danger: "#ff7a8a",
      success: "#95d475",
      cyan: "#7dd7ff",
    });
    expect(s.error("boom")).toContain("boom");
    expect(s.tool("read x")).toContain("read x");
    expect(s.diffAdd("+added")).toContain("+added");
  });
});
