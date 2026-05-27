import { describe, expect, it } from "vitest";
import { formatChromeIndicator } from "../../src/repl/HeaderBar.js";

describe("HeaderBar helpers", () => {
  it("formats model, account label, state, and state dot", () => {
    expect(formatChromeIndicator("opus-4.7", "personal", "tool-running")).toBe("opus-4.7 · personal · tool-running ●");
  });

  it("sanitizes control sequences from the chrome identity", () => {
    const esc = String.fromCharCode(27);
    expect(formatChromeIndicator(`opus${esc}[31m`, `local${esc}[31m`, "ready")).toBe("opus · local · ready ●");
  });
});
