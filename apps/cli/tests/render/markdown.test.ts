import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/render/markdown.js";

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (value: string) => value.replace(ansiPattern, "");

describe("renderMarkdown", () => {
  it("renders headings, lists, links, and blockquotes as terminal text", () => {
    const output = stripAnsi(renderMarkdown("# Title\n\n- one\n- two\n\n> quoted\n\n[docs](https://example.com)"));

    expect(output).toContain("# Title");
    expect(output).toContain("- one");
    expect(output).toContain("│ quoted");
    expect(output).toContain("docs (https://example.com)");
  });

  it("renders fenced code blocks with a language label and border", () => {
    const output = stripAnsi(renderMarkdown("```ts\nconst ok = true;\n```", { columns: 36 }));

    expect(output).toContain("┌─ ts ");
    expect(output).toContain("  const ok = true;");
    expect(output).toContain("└");
  });

  it("renders partial unclosed fences gracefully", () => {
    const output = stripAnsi(renderMarkdown("```diff\n+ added", { columns: 28 }));

    expect(output).toContain("┌─ diff ");
    expect(output).toContain("  + added");
    expect(output).toContain("└");
  });

  it("aligns simple markdown tables", () => {
    const output = stripAnsi(renderMarkdown("| A | B |\n|---|---|\n| one | two |"));

    expect(output).toContain("A");
    expect(output).toContain("one");
    expect(output).toContain("two");
  });
});
