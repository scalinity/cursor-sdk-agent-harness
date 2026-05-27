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

  it("shows explicit unavailable live turn usage without estimating", () => {
    const output = formatStatusBar({
      workspace: "/Users/danny/Documents/Codez/Apps/CursorHarness",
      modelId: "composer-2-5-fast",
      mode: "agent",
      sessionCostMicros: 900,
      turnUsage: { status: "unavailable" },
      connection: "connected",
    });

    expect(output).toContain("turn usage unavailable");
    expect(output).toContain("session $0.0009");
  });

  it("formats available live turn tokens and cost before session cost", () => {
    const output = formatStatusBar({
      workspace: "/Users/danny/Documents/Codez/Apps/CursorHarness",
      modelId: "composer-2-5-fast",
      mode: "agent",
      sessionCostMicros: 100_000,
      turnUsage: { status: "available", tokens: 12_345, costMicros: 9_000 },
      connection: "connected",
    });

    expect(output).toContain("12,345 tok · turn $0.009");
    expect(output).toContain("session $0.10");
  });
});
