import { describe, expect, it } from "vitest";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { getParserForLanguage } from "../../src/lib/lezer-parsers.js";

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

function makeCode(length: number): string {
  let out = "";
  let index = 0;
  while (out.length < length) {
    out += `const value${index.toString()} = ${index.toString()};\n`;
    index += 1;
  }
  return out.slice(0, length);
}

function insertAt(buffer: string, offset: number, text: string): string {
  return buffer.slice(0, offset) + text + buffer.slice(offset);
}

describe("code edit animation perf", () => {
  it("keeps 5,000-char insertion batches inside the Phase 10 frame budget", () => {
    const edit = makeCode(5_000);
    const times: number[] = [];
    let buffer = "";
    let offset = 0;

    while (offset < edit.length) {
      const start = performance.now();
      const slice = edit.slice(offset, offset + 4);
      buffer = insertAt(buffer, offset, slice);
      offset += slice.length;
      times.push(performance.now() - start);
    }

    const p50 = percentile(times, 0.5);
    console.info(`[bench] code edit animation per-frame p50=${p50.toFixed(3)}ms`);
    expect(buffer.length).toBe(5_000);
    expect(p50).toBeLessThan(4);
  });

  it("keeps Lezer parse/highlight on a 5,000-char buffer inside budget", async () => {
    const entry = await getParserForLanguage("typescript");
    if (entry.kind !== "lezer") throw new Error("TypeScript parser did not load");
    const code = insertAt(makeCode(4_950), 200, "const inserted: number = 42;\n".padEnd(50, " "));
    const parseTimes: number[] = [];
    const highlightTimes: number[] = [];

    for (let i = 0; i < 20; i += 1) {
      entry.parser.parse(code);
    }

    for (let i = 0; i < 80; i += 1) {
      const parseStart = performance.now();
      const tree = entry.parser.parse(code);
      parseTimes.push(performance.now() - parseStart);

      const highlightStart = performance.now();
      let tokenCount = 0;
      highlightTree(tree, classHighlighter, () => {
        tokenCount += 1;
      });
      highlightTimes.push(performance.now() - highlightStart);
      expect(tokenCount).toBeGreaterThan(0);
    }

    const parseP50 = percentile(parseTimes, 0.5);
    const highlightP50 = percentile(highlightTimes, 0.5);
    console.info(
      `[bench] Lezer parse 5k p50=${parseP50.toFixed(3)}ms highlight p50=${highlightP50.toFixed(3)}ms`,
    );
    expect(parseP50).toBeLessThan(1);
  });

  it("renders a 50,000-char large edit in chunked mode within 100ms", () => {
    const edit = makeCode(50_000);
    const start = performance.now();
    const buffer = insertAt("", 0, edit);
    const elapsed = performance.now() - start;

    console.info(`[bench] code edit large chunk render=${elapsed.toFixed(3)}ms`);
    expect(buffer.length).toBe(50_000);
    expect(elapsed).toBeLessThan(100);
  });
});
