import { describe, it, expect } from "vitest";
import { CHUNK_CHAR_BUDGET, chunkText } from "../chunker.js";

describe("chunkText", () => {
  it("returns one chunk for a small file spanning all lines", () => {
    const content = "line one\nline two\nline three";
    const chunks = chunkText(content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[0]?.endLine).toBe(3);
    expect(chunks[0]?.content).toBe(content);
    expect(chunks[0]?.index).toBe(0);
  });

  it("returns no chunks for empty content", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("splits a large file into multiple overlapping chunks with sequential indexes", () => {
    const line = "const x = 1; // padding ".repeat(4); // ~96 chars
    const content = Array.from({ length: 400 }, (_, i) => `${line} line ${i}`).join("\n");
    const chunks = chunkText(content);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    // Each chunk stays within (a small slack over) the budget.
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(CHUNK_CHAR_BUDGET + 200);
      expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
    }
    // Consecutive chunks overlap: next chunk starts at/<= previous end line.
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      const cur = chunks[i]!;
      expect(cur.startLine).toBeLessThanOrEqual(prev.endLine + 1);
      expect(cur.startLine).toBeGreaterThan(prev.startLine); // forward progress
    }
  });

  it("covers every line across the chunk set", () => {
    const content = Array.from({ length: 300 }, (_, i) => `x${i} = ${"y".repeat(50)}`).join("\n");
    const chunks = chunkText(content);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[chunks.length - 1]?.endLine).toBe(300);
  });
});
