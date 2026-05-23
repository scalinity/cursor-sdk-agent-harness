import type { KnownLanguage } from "@harness/shared";

export type CodeEditConfidence = "high" | "medium" | "low";

export interface ExtractedCodeEditOperation {
  type: "insert" | "delete" | "replace";
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface ExtractedCodeEditFile {
  path: string;
  language: KnownLanguage | null;
  before?: string;
  after?: string;
  unifiedDiff?: string;
  operations: ExtractedCodeEditOperation[];
}

export interface ExtractedCodeEdit {
  source_call_id: string;
  confidence: CodeEditConfidence;
  edits: ExtractedCodeEditFile[];
}

export interface CodeEditToolCall {
  callId: string;
  name: string;
  args: unknown;
  result: unknown;
  truncated?: {
    args?: boolean | undefined;
    result?: boolean | undefined;
  };
}

export type CodeEditExtractor = (toolCall: CodeEditToolCall) => ExtractedCodeEdit | null;
