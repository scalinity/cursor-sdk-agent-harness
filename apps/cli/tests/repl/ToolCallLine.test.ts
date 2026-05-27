import { describe, expect, it } from "vitest";
import { formatActiveToolLine, formatToolCallLine } from "../../src/repl/ToolCallLine.js";

describe("formatToolCallLine", () => {
  it("freezes completed tools with a check glyph and final duration", () => {
    const line = formatToolCallLine({ verb: "read", primaryArg: "src/a.ts", status: "completed", durationMs: 320 });
    expect(line).toContain("✓");
    expect(line).toContain("read src/a.ts");
    expect(line).toContain("0.3s");
  });

  it("marks failed tools with a cross glyph", () => {
    const line = formatToolCallLine({ verb: "shell", primaryArg: "npm test", status: "error", error: "exit 1" });
    expect(line).toContain("✗");
    expect(line).toContain("exit 1");
  });

  it("renders cancelled tools with a pause glyph and no spinner", () => {
    const line = formatToolCallLine({ verb: "shell", primaryArg: "sleep 100", status: "cancelled" });
    expect(line).toContain("⏸");
    expect(line).toContain("shell sleep 100 (cancelled)");
  });
});

describe("formatActiveToolLine", () => {
  it("shows the spinner, summary, and elapsed seconds", () => {
    expect(formatActiveToolLine("⠙", { verb: "shell", primaryArg: "npm install" }, 12_400)).toBe("⠙ shell npm install  12s");
  });
});
