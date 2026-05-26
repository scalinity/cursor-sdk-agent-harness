import { describe, expect, it } from "vitest";
import { formatStatusBar } from "../../src/repl/StatusBar.js";

describe("StatusBar helpers", () => {
  it("shows the current directory instead of an agent name", () => {
    const output = formatStatusBar({
      workspace: "/Users/danny/Documents/Codez/Apps/CursorHarness",
      modelId: "composer-2-5-fast",
      mode: "agent",
      sessionCostMicros: 0,
      connection: "ready",
    });

    expect(output).toContain("dir: CursorHarness");
    expect(output).toContain("ws: ready");
    expect(output).not.toContain("agent:");
  });
});
