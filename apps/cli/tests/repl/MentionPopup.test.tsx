import { describe, expect, it } from "vitest";
import {
  flattenMentionResults,
  MAX_MENTION_ITEMS,
  mentionItemToChip,
  moveMentionSelection,
} from "../../src/repl/MentionPopup.js";

describe("MentionPopup helpers", () => {
  const results = {
    files: [
      { path: "src/auth.ts", name: "auth.ts", isDirectory: false },
      { path: "src/routes", name: "routes", isDirectory: true },
    ],
    symbols: [
      { name: "login", kind: "function" as const, path: "src/auth.ts", line: 10, preview: "function login()" },
    ],
  };

  it("flattens files, folders, and symbols into selectable mention rows", () => {
    expect(flattenMentionResults(results)).toEqual([
      { kind: "file", value: "src/auth.ts", label: "auth.ts", detail: "src/auth.ts" },
      { kind: "folder", value: "src/routes", label: "routes", detail: "src/routes" },
      { kind: "symbol", value: "src/auth.ts:10:login", label: "login", detail: "function · src/auth.ts:10" },
    ]);
  });

  it("wraps keyboard selection", () => {
    expect(moveMentionSelection(0, -1, 3)).toBe(2);
    expect(moveMentionSelection(2, 1, 3)).toBe(0);
  });

  it("exports the visible mention limit used by the REPL", () => {
    expect(MAX_MENTION_ITEMS).toBe(8);
    expect(moveMentionSelection(7, 1, MAX_MENTION_ITEMS)).toBe(0);
  });

  it("converts selected items into context chips", () => {
    expect(mentionItemToChip({ kind: "file", value: "src/auth.ts", label: "auth.ts" }, 7)).toEqual({
      id: "chip-7",
      mention: { kind: "file", value: "src/auth.ts", displayLabel: "auth.ts" },
    });
  });
});
