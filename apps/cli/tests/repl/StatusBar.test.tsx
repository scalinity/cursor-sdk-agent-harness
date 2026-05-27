import { describe, expect, it } from "vitest";
import { formatStatusBar } from "../../src/repl/StatusBar.js";

describe("StatusBar helpers", () => {
  it("keeps cwd/model/run chrome out of the status line and labels session cost", () => {
    const output = formatStatusBar({
      workspace: "/Users/danny/Documents/Codez/Apps/CursorHarness",
      modelId: "composer-2-5-fast",
      mode: "agent",
      sessionCostMicros: 0,
      connection: "ready",
      activeRunId: "run_12345678",
      queuedPrompts: 2,
    });

    expect(output).toContain("session $0.00");
    expect(output).not.toContain("ws");
    expect(output).not.toContain("ready");
    expect(output).not.toContain("dir:");
    expect(output).not.toContain("CursorHarness");
    expect(output).not.toContain("composer-2-5-fast");
    expect(output).not.toContain("run_12345678");
  });
});
