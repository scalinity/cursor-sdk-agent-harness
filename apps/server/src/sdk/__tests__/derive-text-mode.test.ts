import { describe, it, expect } from "vitest";
import { deriveTextMode } from "../normalizer.js";

// Direct branch coverage for the F-005 helper. The normalizer.test.ts
// suite covers the public normalize() entry point; this file pins each
// of deriveTextMode's four branches so a future refactor of the helper
// fails locally instead of silently changing buffer semantics.

const KINDS = { deltaKind: "assistant.delta" } as const;

describe("deriveTextMode", () => {
  it("empty current → zero-length delta, buffer unchanged", () => {
    const result = deriveTextMode("HEL", "", KINDS);
    expect(result).toEqual({
      kind: "assistant.delta",
      textDelta: null,
      isReplacement: false,
      fullTextLength: 3,
      newBufferText: "HEL",
    });
  });

  it("empty previous → first-emit delta carries the whole string", () => {
    const result = deriveTextMode("", "HEL", KINDS);
    expect(result).toEqual({
      kind: "assistant.delta",
      textDelta: "HEL",
      isReplacement: false,
      fullTextLength: 3,
      newBufferText: "HEL",
    });
  });

  it("prefix-match (cumulative SDK shape) → suffix-only delta, buffer = current", () => {
    const result = deriveTextMode("HEL", "HELLO", KINDS);
    expect(result).toEqual({
      kind: "assistant.delta",
      textDelta: "LO",
      isReplacement: false,
      fullTextLength: 5,
      newBufferText: "HELLO",
    });
  });

  it("non-prefix follow-up (per-message delta, observed SDK shape) → append, buffer = previous+current", () => {
    // This is the F-005 regression. Before the fix this returned a
    // snapshot-replacement and silently dropped "HEL".
    const result = deriveTextMode("HEL", "LO", KINDS);
    expect(result).toEqual({
      kind: "assistant.delta",
      textDelta: "LO",
      isReplacement: false,
      fullTextLength: 5,
      newBufferText: "HELLO",
    });
  });

  it("never emits a snapshot kind regardless of input shape", () => {
    const fixtures: Array<[string, string]> = [
      ["", ""],
      ["", "x"],
      ["abc", "abcdef"],
      ["abc", "xyz"],
      ["abc", ""],
    ];
    for (const [prev, cur] of fixtures) {
      const result = deriveTextMode(prev, cur, KINDS);
      expect(result.kind).toBe("assistant.delta");
      expect(result.isReplacement).toBe(false);
    }
  });

  it("respects custom deltaKind label for thinking source", () => {
    const result = deriveTextMode("a", "ab", { deltaKind: "thinking.delta" });
    expect(result.kind).toBe("thinking.delta");
    expect(result.textDelta).toBe("b");
    expect(result.newBufferText).toBe("ab");
  });
});
