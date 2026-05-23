import { describe, expect, it } from "vitest";
import { extractCodeEdit, inferLanguageFromPath } from "./index.js";

describe("code edit extractors", () => {
  it("infers known languages from paths", () => {
    expect(inferLanguageFromPath("src/App.tsx")).toBe("typescript");
    expect(inferLanguageFromPath("scripts/build.mjs")).toBe("javascript");
    expect(inferLanguageFromPath("tools/check.py")).toBe("python");
    expect(inferLanguageFromPath("package.json")).toBe("json");
    expect(inferLanguageFromPath("README.md")).toBe("markdown");
    expect(inferLanguageFromPath("scripts/dev.zsh")).toBe("shell");
    expect(inferLanguageFromPath("LICENSE")).toBe("plain-text");
  });

  it("extracts a high-confidence edit from Cursor edit result.value.diffString", () => {
    const diff = [
      "diff --git a/src/demo.ts b/src/demo.ts",
      "--- a/src/demo.ts",
      "+++ b/src/demo.ts",
      "@@ -1,3 +1,4 @@",
      " const before = 1;",
      "+const inserted = 2;",
      " export { before };",
      "",
    ].join("\n");

    const out = extractCodeEdit({
      callId: "call-edit",
      name: "edit",
      args: { path: "src/demo.ts" },
      result: { status: "success", value: { diffString: diff } },
    });

    expect(out).toMatchObject({
      source_call_id: "call-edit",
      confidence: "high",
      edits: [
        {
          path: "src/demo.ts",
          language: "typescript",
          unifiedDiff: diff,
        },
      ],
    });
    expect(out?.edits[0]?.operations).toEqual([
      expect.objectContaining({ type: "replace", text: expect.stringContaining("const inserted = 2;") }),
    ]);
  });

  it("keeps multi-file unified diffs split by edited path", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-export const a = 1;",
      "+export const a = 2;",
      "diff --git a/src/b.py b/src/b.py",
      "--- a/src/b.py",
      "+++ b/src/b.py",
      "@@ -1 +1 @@",
      "-print('old')",
      "+print('new')",
      "",
    ].join("\n");

    const out = extractCodeEdit({
      callId: "call-multi",
      name: "edit",
      args: { path: "src/a.ts" },
      result: { status: "success", value: { diffString: diff } },
    });

    expect(out?.edits).toHaveLength(2);
    expect(out?.edits.map((edit) => edit.path)).toEqual(["src/a.ts", "src/b.py"]);
    expect(out?.edits[0]?.operations[0]?.text).toContain("export const a = 2;");
    expect(out?.edits[1]?.operations[0]?.text).toContain("print('new')");
  });

  it("extracts before/after args as a replacement operation", () => {
    const out = extractCodeEdit({
      callId: "call-before-after",
      name: "edit_file",
      args: {
        path: "src/example.ts",
        before: "const answer = 41;\n",
        after: "const answer = 42;\n",
      },
      result: { ok: true },
    });

    expect(out?.confidence).toBe("high");
    expect(out?.edits[0]).toMatchObject({
      path: "src/example.ts",
      before: "const answer = 41;\n",
      after: "const answer = 42;\n",
      operations: [{ type: "replace", startOffset: 15, endOffset: 17, text: "42" }],
    });
  });

  it("extracts old_text/new_text args as a replacement operation", () => {
    const out = extractCodeEdit({
      callId: "call-old-new",
      name: "str_replace",
      args: {
        path: "src/message.js",
        old_text: "console.log('old')",
        new_text: "console.log('new')",
      },
      result: "ok",
    });

    expect(out?.confidence).toBe("high");
    expect(out?.edits[0]).toMatchObject({
      path: "src/message.js",
      language: "javascript",
      before: "console.log('old')",
      after: "console.log('new')",
      operations: [{ type: "replace", startOffset: 13, endOffset: 16, text: "new" }],
    });
  });

  it("extracts medium-confidence result-only writes", () => {
    const out = extractCodeEdit({
      callId: "call-write",
      name: "write",
      args: { path: "src/new.py", fileText: "print('hi')\n" },
      result: { status: "success", value: { path: "src/new.py", linesCreated: 1 } },
    });

    expect(out).toMatchObject({
      source_call_id: "call-write",
      confidence: "medium",
      edits: [
        {
          path: "src/new.py",
          language: "python",
          after: "print('hi')\n",
          operations: [{ type: "insert", startOffset: 0, endOffset: 0, text: "print('hi')\n" }],
        },
      ],
    });
  });

  it("returns null for truncated tool calls", () => {
    expect(
      extractCodeEdit({
        callId: "call-truncated",
        name: "edit",
        args: { path: "src/demo.ts" },
        result: { status: "success", value: { diffString: "--- a\n+++ b\n" } },
        truncated: { result: true },
      }),
    ).toBeNull();
  });

  it("does not infer code edits from summaries on unrelated tools", () => {
    const out = extractCodeEdit({
      callId: "call-search",
      name: "grep",
      args: {},
      result: {
        summary: "2 insertions, 1 deletion",
        diff: "--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-old\n+new\n",
      },
    });

    expect(out).toBeNull();
  });
});
