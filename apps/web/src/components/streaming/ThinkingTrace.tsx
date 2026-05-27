import { useState } from "react";
import { useRunStore } from "../../state/run-store.js";
import { StreamingMarkdown } from "./StreamingMarkdown.js";
import { StreamingText } from "./StreamingText.js";

export interface ThinkingTraceProps {
  runId: string;
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

export function ThinkingTrace({ runId }: ThinkingTraceProps) {
  const thinkingText = useRunStore((s) => s.eventsByRunId[runId]?.thinkingText ?? "");
  const assistantText = useRunStore((s) => s.eventsByRunId[runId]?.assistantText ?? "");
  const status = useRunStore((s) => s.byId[runId]?.status ?? null);
  const durationMs = useRunStore((s) => s.eventsByRunId[runId]?.thinkingDurationMs ?? null);
  const [overrideExpanded, setOverrideExpanded] = useState<boolean | null>(null);

  if (!thinkingText) return null;

  const defaultExpanded = !isTerminal(status) && assistantText.length === 0;
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
            <StreamingMarkdown runId={runId} source="thinking" />
          ) : (
            <StreamingText text={thinkingText} streamId={`thinking-${runId}`} />
          )}
        </div>
      ) : null}
    </div>
  );
}
