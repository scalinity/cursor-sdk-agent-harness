import { describe, expect, it } from "vitest";
import { createMarkdownProjector } from "../streaming-markdown-projector.js";

describe("streaming markdown projector", () => {
  it("projects headings, paragraphs, lists, code fences, blockquotes, tables, and rules", () => {
    const projector = createMarkdownProjector();
    projector.write(
      [
        "# Heading",
        "",
        "First paragraph",
        "continues",
        "",
        "- one",
        "- two",
        "",
        "```ts",
        "const value = 1;",
        "```",
        "",
        "> quoted",
        "",
        "| A | B |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "---",
        "",
      ].join("\n"),
    );

    expect(projector.getBlocks()).toEqual([
      { id: "md-1", type: "heading", level: 1, text: "Heading" },
      { id: "md-2", type: "paragraph", text: "First paragraph\ncontinues" },
      {
        id: "md-3",
        type: "list",
        ordered: false,
        items: [
          { id: "md-4", text: "one" },
          { id: "md-5", text: "two" },
        ],
      },
      { id: "md-6", type: "code", language: "ts", text: "const value = 1;", closed: true },
      { id: "md-7", type: "blockquote", text: "quoted" },
      {
        id: "md-8",
        type: "table",
        rows: [
          ["A", "B"],
          ["1", "2"],
        ],
        closed: true,
      },
      { id: "md-9", type: "thematic_break" },
    ]);
  });

  it("marks prose-only appends as non-structural and keeps block identity stable", () => {
    const projector = createMarkdownProjector();
    const first = projector.write("Hello");
    const firstBlock = projector.getBlocks()[0];
    const second = projector.write(" world");

    expect(first.structural).toBe(true);
    expect(second.structural).toBe(false);
    expect(projector.getBlocks()[0]?.id).toBe(firstBlock?.id);
    expect(projector.getBlocks()[0]).toMatchObject({ type: "paragraph", text: "Hello world" });
  });

  it("previews the parser pending tail so single-character prose stays visible", () => {
    const projector = createMarkdownProjector();
    projector.write("H");
    expect(projector.getBlocks()[0]).toMatchObject({ type: "paragraph", text: "H" });

    projector.write("i");
    expect(projector.getBlocks()[0]).toMatchObject({ type: "paragraph", text: "Hi" });
  });

  it("keeps an unclosed code fence open until a closing fence arrives", () => {
    const projector = createMarkdownProjector();
    projector.write("```ts\nconst x = 1;");
    expect(projector.getBlocks()).toEqual([
      { id: "md-1", type: "code", language: "ts", text: "const x = 1;", closed: false },
    ]);

    projector.write("\n```\n");
    expect(projector.getBlocks()[0]).toEqual({
      id: "md-1",
      type: "code",
      language: "ts",
      text: "const x = 1;",
      closed: true,
    });
  });
});
