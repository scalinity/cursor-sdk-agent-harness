import { describe, expect, it } from "vitest";
import {
  parseTerminalServerFrame,
  serializeTerminalInput,
  serializeTerminalResize,
} from "./terminal-client.js";

describe("terminal-client framing", () => {
  it("serializes input as an input frame", () => {
    expect(JSON.parse(serializeTerminalInput("ls -la\n"))).toEqual({
      type: "input",
      data: "ls -la\n",
    });
  });

  it("serializes resize as a resize frame", () => {
    expect(JSON.parse(serializeTerminalResize(120, 40))).toEqual({
      type: "resize",
      cols: 120,
      rows: 40,
    });
  });

  it("parses a valid data frame", () => {
    const frame = parseTerminalServerFrame(JSON.stringify({ type: "data", data: "hi" }));
    expect(frame).toEqual({ type: "data", data: "hi" });
  });

  it("parses ready and exit frames", () => {
    expect(
      parseTerminalServerFrame(JSON.stringify({ type: "ready", cols: 80, rows: 24, cwd: "/tmp" })),
    ).toEqual({ type: "ready", cols: 80, rows: 24, cwd: "/tmp" });
    expect(parseTerminalServerFrame(JSON.stringify({ type: "exit", code: 0 }))).toEqual({
      type: "exit",
      code: 0,
    });
  });

  it("returns null for non-JSON input", () => {
    expect(parseTerminalServerFrame("not json{")).toBeNull();
  });

  it("returns null for a frame that fails schema validation", () => {
    // unknown discriminant
    expect(parseTerminalServerFrame(JSON.stringify({ type: "bogus" }))).toBeNull();
    // wrong field type
    expect(
      parseTerminalServerFrame(JSON.stringify({ type: "resize", cols: "wide", rows: 24 })),
    ).toBeNull();
  });
});
