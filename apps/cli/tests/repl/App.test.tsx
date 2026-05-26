import { describe, expect, it } from "vitest";
import { formatUserPromptBlock } from "../../src/repl/App.js";

describe("App prompt formatting", () => {
  it("adds a blank line between the user prompt and the next stream item", () => {
    expect(formatUserPromptBlock("test")).toBe("\n❯ test\n\n");
  });
});
