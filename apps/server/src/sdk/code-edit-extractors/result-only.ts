import type { CodeEditExtractor } from "./types.js";
import {
  getFirstString,
  getNestedString,
  getString,
  hasToolName,
  makeSingleEdit,
  resultValue,
} from "./utils.js";

const RESULT_ONLY_TOOL_NAMES = new Set(["write", "write_file", "create_file"]);

export const resultOnlyExtractor: CodeEditExtractor = (toolCall) => {
  if (!hasToolName(toolCall.name, RESULT_ONLY_TOOL_NAMES)) return null;
  const value = resultValue(toolCall.result);
  const path =
    getFirstString(value, ["path", "file", "filePath"]) ??
    getFirstString(toolCall.args, ["path", "file", "filePath"]);
  const content =
    getString(value, "content") ??
    getString(value, "fileContentAfterWrite") ??
    getNestedString(toolCall.result, ["value", "fileContentAfterWrite"]) ??
    getFirstString(toolCall.args, ["fileText", "content", "text"]);
  if (path === null || content === null) return null;

  return {
    source_call_id: toolCall.callId,
    confidence: "medium",
    edits: [
      makeSingleEdit({
        path,
        after: content,
        operations: [{ type: "insert", startOffset: 0, endOffset: 0, text: content }],
      }),
    ],
  };
};
