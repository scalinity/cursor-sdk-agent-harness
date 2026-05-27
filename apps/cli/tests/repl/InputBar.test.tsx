import { describe, expect, it } from "vitest";
import {
  PromptHistory,
  applyMentionSelection,
  findMentionTrigger,
  isBackspaceInput,
  parseSlashCommand,
} from "../../src/repl/InputBar.js";
import {
  shouldReserveArrowKeysForStreamScroll,
  shouldUseCtrlForPromptHistory,
} from "../../src/repl/stream-scroll.js";
import { extractImageDropPaths } from "../../src/lib/attachments.js";

describe("InputBar helpers", () => {
  it("detects the active @-mention trigger before the cursor", () => {
    expect(findMentionTrigger("please inspect @auth", 20)).toEqual({ start: 15, query: "auth" });
    expect(findMentionTrigger("email me@site.test", 18)).toBeNull();
  });

  it("turns a selected mention into a chip and removes the typed query", () => {
    const result = applyMentionSelection({
      text: "fix @auth bug",
      cursor: 9,
      chips: [],
      item: { kind: "file", value: "src/auth.ts", label: "auth.ts" },
    });

    expect(result.text).toBe("fix  bug");
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0]?.mention).toEqual({
      kind: "file",
      value: "src/auth.ts",
      displayLabel: "auth.ts",
    });
  });

  it("parses known slash commands and rejects unknown commands", () => {
    expect(parseSlashCommand("/mode ask")).toEqual({ command: "mode", args: ["ask"] });
    expect(parseSlashCommand("/clear")).toEqual({ command: "clear", args: [] });
    expect(parseSlashCommand("/wat nope")).toEqual({ command: "unknown", args: ["wat", "nope"] });
  });

  it("recognizes backspace from Ink keys and raw terminal codes", () => {
    expect(isBackspaceInput("", { backspace: true })).toBe(true);
    expect(isBackspaceInput("", { delete: true })).toBe(true);
    expect(isBackspaceInput("\u007f", {})).toBe(true);
    expect(isBackspaceInput("\b", {})).toBe(true);
    expect(isBackspaceInput("x", {})).toBe(false);
  });

  it("cycles prompt history only when input is empty", () => {
    const history = new PromptHistory(["first", "second"]);

    expect(history.previous("")).toBe("second");
    expect(history.previous("")).toBe("first");
    expect(history.next("")).toBe("second");
    expect(history.previous("draft")).toBe("draft");
  });

  it("delegates image drop detection to attachment helpers", () => {
    expect(extractImageDropPaths("/tmp/shot.png")).toEqual(["/tmp/shot.png"]);
    expect(extractImageDropPaths("hello")).toBeNull();
  });

  it("reserves arrow keys for stream scroll when the stream is scrollable", () => {
    expect(shouldReserveArrowKeysForStreamScroll(true)).toBe(true);
    expect(shouldUseCtrlForPromptHistory(true)).toBe(true);
    expect(shouldReserveArrowKeysForStreamScroll(false)).toBe(false);
    expect(shouldUseCtrlForPromptHistory(false)).toBe(false);
  });
});
