import type { CodeEditExtractor } from "./types.js";
import { getNestedString, getString, hasToolName, isRecord, makeSingleEdit } from "./utils.js";
import { parseUnifiedDiff } from "./unified-diff.js";

const SUMMARY_PATTERN = /\b\d+\s+insertions?\b.*\b\d+\s+deletions?\b|\b\d+\s+deletions?\b.*\b\d+\s+insertions?\b/i;
const SUMMARY_TOOL_NAMES = new Set(["edit", "edit_file", "write", "write_file", "apply_diff", "str_replace", "replace"]);

function findSummary(value: unknown): string | null {
  const direct = getString(value, "summary");
  if (direct !== null) return direct;
  const nested = getNestedString(value, ["value", "summary"]);
  return nested;
}

function findDiff(value: unknown): string | null {
  return getString(value, "diff") ?? getString(value, "diffString") ?? getNestedString(value, ["value", "diff"]) ?? getNestedString(value, ["value", "diffString"]);
}

export const inferredFromSummaryExtractor: CodeEditExtractor = (toolCall) => {
  if (!hasToolName(toolCall.name, SUMMARY_TOOL_NAMES)) return null;
  const summary = findSummary(toolCall.result) ?? findSummary(toolCall.args);
  if (summary === null || !SUMMARY_PATTERN.test(summary)) return null;
  const diff = findDiff(toolCall.result) ?? findDiff(toolCall.args);
  if (diff === null) return null;

  const parsedFiles = parseUnifiedDiff(diff);
  const resultPath = isRecord(toolCall.result) ? getString(toolCall.result, "path") : null;
  const argsPath = isRecord(toolCall.args) ? getString(toolCall.args, "path") : null;
  const fallbackPath = argsPath ?? resultPath;
  const files = parsedFiles
    .map((file) => ({ ...file, path: file.path ?? fallbackPath }))
    .filter((file): file is (typeof parsedFiles)[number] & { path: string } => file.path !== null);
  if (files.length === 0) return null;

  return {
    source_call_id: toolCall.callId,
    confidence: "low",
    edits: files.map((file) =>
      makeSingleEdit({
        path: file.path,
        before: file.before,
        after: file.after,
        unifiedDiff: file.unifiedDiff,
        operations: file.operations,
      }),
    ),
  };
};
