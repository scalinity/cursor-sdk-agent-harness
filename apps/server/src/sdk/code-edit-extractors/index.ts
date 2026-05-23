import { beforeAfterExtractor } from "./before-after.js";
import { inferredFromSummaryExtractor } from "./inferred-from-summary.js";
import { oldNewTextExtractor } from "./old-new-text.js";
import { resultOnlyExtractor } from "./result-only.js";
import type { CodeEditExtractor, CodeEditToolCall, ExtractedCodeEdit } from "./types.js";
import { unifiedDiffExtractor } from "./unified-diff.js";

export type {
  CodeEditConfidence,
  CodeEditExtractor,
  CodeEditToolCall,
  ExtractedCodeEdit,
  ExtractedCodeEditFile,
  ExtractedCodeEditOperation,
} from "./types.js";
export { inferLanguageFromPath } from "./utils.js";

const EXTRACTORS: readonly CodeEditExtractor[] = [
  unifiedDiffExtractor,
  beforeAfterExtractor,
  oldNewTextExtractor,
  resultOnlyExtractor,
  inferredFromSummaryExtractor,
];

function isTruncated(toolCall: CodeEditToolCall): boolean {
  return toolCall.truncated?.args === true || toolCall.truncated?.result === true;
}

export function extractCodeEdit(toolCall: CodeEditToolCall): ExtractedCodeEdit | null {
  if (isTruncated(toolCall)) return null;
  for (const extractor of EXTRACTORS) {
    const extracted = extractor(toolCall);
    if (extracted !== null && extracted.edits.length > 0) return extracted;
  }
  return null;
}
