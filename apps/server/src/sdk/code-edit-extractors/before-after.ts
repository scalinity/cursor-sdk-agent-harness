import type { CodeEditExtractor } from "./types.js";
import { deriveTextOperations, getFirstString, hasToolName, makeSingleEdit } from "./utils.js";

const BEFORE_AFTER_TOOL_NAMES = new Set(["edit", "edit_file", "write", "write_file"]);

export const beforeAfterExtractor: CodeEditExtractor = (toolCall) => {
  if (!hasToolName(toolCall.name, BEFORE_AFTER_TOOL_NAMES)) return null;
  const path = getFirstString(toolCall.args, ["path", "file", "filePath"]);
  const before = getFirstString(toolCall.args, ["before", "beforeText", "oldContent"]);
  const after = getFirstString(toolCall.args, ["after", "afterText", "newContent"]);
  if (path === null || before === null || after === null) return null;

  const operations = deriveTextOperations(before, after);
  if (operations.length === 0) return null;

  return {
    source_call_id: toolCall.callId,
    confidence: "high",
    edits: [makeSingleEdit({ path, before, after, operations })],
  };
};
