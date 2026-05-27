import React from "react";
import { describe, expect, it } from "vitest";
import {
  HeaderBar,
  formatChromeIndicator,
  formatHeaderCwdLabel,
} from "../../src/repl/HeaderBar.js";
import { createTuiTheme } from "../../src/repl/theme.js";

describe("HeaderBar helpers", () => {
  it("formats model, account label, state, and state dot", () => {
    expect(formatChromeIndicator("opus-4.7", "personal", "tool-running")).toBe(
      "opus-4.7 · personal · tool-running ●",
    );
  });

  it("sanitizes control sequences and line breaks from the chrome identity", () => {
    const esc = String.fromCharCode(27);
    expect(formatChromeIndicator(`opus${esc}[31m\nspoof`, `local${esc}[31m\rnext`, "ready")).toBe(
      "opus spoof · local next · ready ●",
    );
  });

  it("normalizes cwd against the captured launch cwd", () => {
    expect(formatHeaderCwdLabel("/work/proj/src/app.ts", "/work/proj", 80)).toBe("src/app.ts");
  });

  it("shows the captured launch cwd instead of a relative dot", () => {
    expect(formatHeaderCwdLabel("/work/proj", "/work/proj", 80)).toBe("/work/proj");
  });

  it("renders the path without a cwd prefix", () => {
    const text = collectText(
      HeaderBar({
        width: 100,
        workspace: "/work/proj",
        cwdBase: "/work/proj",
        modelId: "composer-2-5-fast",
        accountLabel: "local",
        chromeState: "ready",
        queuedPrompts: 0,
        theme: createTuiTheme({ NO_COLOR: "1" }),
      }),
    );

    expect(text).toContain("/work/proj");
    expect(text).not.toContain("cwd /work/proj");
    expect(text).not.toContain("cwd .");
  });

  it("keeps normalized cwd to a single terminal line", () => {
    expect(formatHeaderCwdLabel("/work/proj/evil\nrow", "/work/proj", 80)).toBe("evil row");
  });
});

function collectText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node))
    return collectText(node.props.children);
  return "";
}
