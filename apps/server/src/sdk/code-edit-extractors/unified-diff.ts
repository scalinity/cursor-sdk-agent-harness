import type { CodeEditExtractor, ExtractedCodeEditOperation } from "./types.js";
import {
  getFirstString,
  getNestedString,
  getString,
  hasToolName,
  isRecord,
  makeSingleEdit,
  resultValue,
} from "./utils.js";

const UNIFIED_DIFF_TOOL_NAMES = new Set([
  "edit",
  "edit_file",
  "write",
  "write_file",
  "apply_diff",
]);

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface ParsedUnifiedDiffFile {
  path: string | null;
  operations: ExtractedCodeEditOperation[];
  before: string;
  after: string;
  unifiedDiff: string;
}

function cleanDiffPath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") return null;
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) return trimmed.slice(2);
  return trimmed || null;
}

function parsePathFromDiffLine(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) return null;
  const body = line.slice(prefix.length).trim().split(/\s+/)[0] ?? "";
  return cleanDiffPath(body);
}

function splitDiffByFile(diff: string): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      segments.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0 && current.some((line) => line.trim().length > 0)) {
    segments.push(current.join("\n"));
  }
  return segments;
}

function parseUnifiedDiffFile(diff: string): ParsedUnifiedDiffFile {
  const lines = diff.split("\n");
  let path: string | null = null;
  const operations: ExtractedCodeEditOperation[] = [];
  let before = "";
  let after = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextPath = parsePathFromDiffLine(line, "+++ ");
    if (nextPath !== null) path = nextPath;

    const hunk = HUNK_HEADER.exec(line);
    if (!hunk) continue;

    let hunkBefore = "";
    let hunkAfter = "";
    index += 1;
    while (index < lines.length) {
      const hunkLine = lines[index] ?? "";
      if (HUNK_HEADER.test(hunkLine)) {
        index -= 1;
        break;
      }
      if (hunkLine.startsWith("diff --git ") || hunkLine.startsWith("--- ") || hunkLine.startsWith("+++ ")) {
        index -= 1;
        break;
      }
      if (hunkLine.startsWith("\\")) {
        index += 1;
        continue;
      }
      const body = hunkLine.length > 0 ? hunkLine.slice(1) : "";
      const withNewline = index === lines.length - 1 && body === "" ? "" : `${body}\n`;
      if (hunkLine.startsWith("+")) {
        hunkAfter += withNewline;
      } else if (hunkLine.startsWith("-")) {
        hunkBefore += withNewline;
      } else {
        hunkBefore += withNewline;
        hunkAfter += withNewline;
      }
      index += 1;
    }

    before += hunkBefore;
    after += hunkAfter;
    const startOffset = before.length - hunkBefore.length;
    operations.push({
      type: "replace",
      startOffset,
      endOffset: startOffset + hunkBefore.length,
      text: hunkAfter,
    });
  }

  return { path, operations, before, after, unifiedDiff: diff };
}

export function parseUnifiedDiff(diff: string): ParsedUnifiedDiffFile[] {
  return splitDiffByFile(diff)
    .map((segment) => parseUnifiedDiffFile(segment))
    .filter((file) => file.path !== null || file.operations.length > 0);
}

function diffFromToolCall(args: unknown, result: unknown): string | null {
  return (
    getString(result, "diff") ??
    getString(args, "diff") ??
    getNestedString(result, ["value", "diffString"]) ??
    getNestedString(result, ["value", "diff"]) ??
    getString(resultValue(result), "diffString") ??
    getString(resultValue(result), "diff")
  );
}

export const unifiedDiffExtractor: CodeEditExtractor = (toolCall) => {
  if (!hasToolName(toolCall.name, UNIFIED_DIFF_TOOL_NAMES)) return null;
  const diff = diffFromToolCall(toolCall.args, toolCall.result);
  if (diff === null || diff.trim().length === 0) return null;

  const parsedFiles = parseUnifiedDiff(diff);
  const fallbackPath = getFirstString(toolCall.args, ["path", "file", "filePath"]);
  const files = parsedFiles
    .map((file) => ({ ...file, path: file.path ?? fallbackPath }))
    .filter((file): file is ParsedUnifiedDiffFile & { path: string } => file.path !== null);
  if (files.length === 0) return null;
  if (files.every((file) => file.operations.length === 0) && !isRecord(toolCall.result)) return null;

  return {
    source_call_id: toolCall.callId,
    confidence: "high",
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
