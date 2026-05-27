import { describe, expect, it } from "vitest";
import { formatChromeIndicator, formatHeaderCwdLabel } from "../../src/repl/HeaderBar.js";

describe("HeaderBar helpers", () => {
  it("formats model, account label, state, and state dot", () => {
    expect(formatChromeIndicator("opus-4.7", "personal", "tool-running")).toBe("opus-4.7 · personal · tool-running ●");
  });

  it("sanitizes control sequences and line breaks from the chrome identity", () => {
    const esc = String.fromCharCode(27);
    expect(formatChromeIndicator(`opus${esc}[31m\nspoof`, `local${esc}[31m\rnext`, "ready")).toBe("opus spoof · local next · ready ●");
  });

  it("normalizes cwd against the captured launch cwd", () => {
    expect(formatHeaderCwdLabel("/work/proj/src/app.ts", "/work/proj", 80)).toBe("src/app.ts");
  });

  it("keeps normalized cwd to a single terminal line", () => {
    expect(formatHeaderCwdLabel("/work/proj/evil\nrow", "/work/proj", 80)).toBe("evil row");
  });
});
