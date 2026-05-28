import { useMemo, useState } from "react";
import {
  deriveTextForSeqRangeFromRunState,
  deriveThinkingDurationForSeqRange,
} from "../../lib/timeline-segments.js";
import { flattenEventChunks, useRunStore } from "../../state/run-store.js";
import { StreamingMarkdown } from "./StreamingMarkdown.js";
import { StreamingText } from "./StreamingText.js";

export interface ThinkingTraceProps {
  runId: string;
  startSeq?: number | undefined;
  endSeq?: number | undefined;
}

function isTerminal(status: string | null | undefined): boolean {
  return status === "FINISHED" || status === "ERROR" || status === "CANCELLED" || status === "EXPIRED";
}

function hasMarkdownLikeStructure(text: string): boolean {
  return text.includes("`") || /(^|\n)(#{1,6}\s|[-*]\s|>\s|```|\|.+\|)/.test(text);
}

function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

export function ThinkingTrace({ runId, startSeq, endSeq }: ThinkingTraceProps) {
  const runEvents = useRunStore((s) => s.eventsByRunId[runId] ?? null);
  const eventChunks = runEvents?.eventChunks ?? null;
  const runThinkingText = runEvents?.thinkingText ?? "";
  const runAssistantText = runEvents?.assistantText ?? "";
  const status = useRunStore((s) => s.byId[runId]?.status ?? null);
  const runDurationMs = runEvents?.thinkingDurationMs ?? null;
  const [overrideExpanded, setOverrideExpanded] = useState<boolean | null>(null);

  const thinkingText = useMemo(() => {
    if (!runEvents) return "";
    if (startSeq !== undefined && endSeq !== undefined) {
      return deriveTextForSeqRangeFromRunState(runEvents, "thinking", startSeq, endSeq);
    }
    return runThinkingText;
  }, [endSeq, runEvents, runThinkingText, startSeq]);

  const durationMs = useMemo(() => {
    if (!runEvents) return null;
    if (startSeq !== undefined && endSeq !== undefined) {
      return deriveThinkingDurationForSeqRange(runEvents, startSeq, endSeq);
    }
    return runDurationMs;
  }, [endSeq, runDurationMs, runEvents, startSeq]);

  const hasAssistantAfter = useMemo(() => {
    if (startSeq === undefined || endSeq === undefined || !eventChunks) {
      return runAssistantText.length > 0;
    }
    for (const evt of flattenEventChunks(eventChunks)) {
      if (evt.seq <= endSeq) continue;
      if (evt.sdk_type === "user") break;
      if (evt.sdk_type === "assistant") return true;
    }
    return false;
  }, [endSeq, eventChunks, runAssistantText, startSeq]);

  if (!thinkingText) return null;

  const defaultExpanded = !isTerminal(status) && !hasAssistantAfter;
  const expanded = overrideExpanded ?? defaultExpanded;
  const duration = formatDuration(durationMs);

  return (
    <div className="think">
      <button
        type="button"
        className="think__label"
        onClick={() => setOverrideExpanded((value) => !(value ?? defaultExpanded))}
        aria-expanded={expanded}
      >
        <span>REASONING{duration ? ` · ${duration}` : ""}</span>
      </button>
      {expanded ? (
        <div className="think__body">
          {hasMarkdownLikeStructure(thinkingText) ? (
            <StreamingMarkdown runId={runId} source="thinking" startSeq={startSeq} endSeq={endSeq} />
          ) : (
            <StreamingText
              text={thinkingText}
              streamId={
                startSeq !== undefined && endSeq !== undefined
                  ? `thinking-${runId}:${startSeq}-${endSeq}`
                  : `thinking-${runId}`
              }
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
