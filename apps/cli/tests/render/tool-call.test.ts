import { describe, expect, it } from "vitest";
import { formatToolCall } from "../../src/render/tool-call.js";

const cwd = "/home/u/proj";
const ESC = String.fromCharCode(27);

describe("formatToolCall", () => {
  it("summarizes read/write/edit with a normalized path", () => {
    expect(formatToolCall("read_file", { path: "/home/u/proj/src/a.ts" }, cwd)).toEqual({ verb: "read", primaryArg: "src/a.ts" });
    expect(formatToolCall("write", { path: "src/new.ts", contents: "x" }, cwd)).toEqual({ verb: "write", primaryArg: "src/new.ts" });
    expect(formatToolCall("str_replace_editor", { file_path: "src/a.ts" }, cwd)).toEqual({ verb: "edit", primaryArg: "src/a.ts" });
  });

  it("summarizes glob/grep with pattern and optional scope", () => {
    expect(formatToolCall("glob", { pattern: "**/*.ts" }, cwd)).toEqual({ verb: "glob", primaryArg: "**/*.ts" });
    expect(formatToolCall("grep", { pattern: "TODO", path: "/home/u/proj/src" }, cwd)).toEqual({ verb: "grep", primaryArg: "TODO", secondaryDetail: "in src" });
  });

  it("summarizes shell commands as a single line without normalizing paths", () => {
    expect(formatToolCall("run_terminal_cmd", { command: "cd Pool2 && npm run dev" }, cwd)).toEqual({ verb: "shell", primaryArg: "cd Pool2 && npm run dev" });
    expect(formatToolCall("bash", { command: "echo a\n  echo b" }, cwd)).toEqual({ verb: "shell", primaryArg: "echo a echo b" });
  });

  it("summarizes web tools", () => {
    expect(formatToolCall("web_search", { query: "ink react" }, cwd)).toEqual({ verb: "search", primaryArg: "ink react" });
    expect(formatToolCall("web_fetch", { url: "https://example.com" }, cwd)).toEqual({ verb: "fetch", primaryArg: "https://example.com" });
  });

  it("falls back to {name} {first-string-arg} for unknown tools, never raw JSON", () => {
    expect(formatToolCall("codebase_search", { query: "where is auth" }, cwd)).toEqual({ verb: "codebase_search", primaryArg: "where is auth" });
    expect(formatToolCall("mystery", { count: 3 }, cwd)).toEqual({ verb: "mystery", primaryArg: "count" });
    expect(formatToolCall("mystery", undefined, cwd)).toEqual({ verb: "mystery", primaryArg: "" });
  });

  it("strips control sequences from extracted values", () => {
    const summary = formatToolCall("read", { path: `src/${ESC}[31ma.ts` }, cwd);
    expect(summary.primaryArg).toBe("src/a.ts");
  });
});
