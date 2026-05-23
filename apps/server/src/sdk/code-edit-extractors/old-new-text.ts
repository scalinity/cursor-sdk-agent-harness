import type { CodeEditExtractor } from "./types.js";
import { deriveTextOperations, getFirstString, hasToolName, makeSingleEdit } from "./utils.js";

const OLD_NEW_TOOL_NAMES = new Set(["edit", "edit_file", "str_replace", "replace"]);

export const oldNewTextExtractor: CodeEditExtractor = (toolCall) => {
  if (!hasToolName(toolCall.name, OLD_NEW_TOOL_NAMES)) return null;
  const path = getFirstString(toolCall.args, ["path", "file", "filePath"]);
  const before = getFirstString(toolCall.args, ["old_text", "oldText", "old"]);
  const after = getFirstString(toolCall.args, ["new_text", "newText", "new"]);
  if (path === null || before === null || after === null) return null;

  const operations = deriveTextOperations(before, after);
  if (operations.length === 0) return null;

  return {
    source_call_id: toolCall.callId,
    confidence: "high",
    edits: [makeSingleEdit({ path, before, after, operations })],
  };
};
