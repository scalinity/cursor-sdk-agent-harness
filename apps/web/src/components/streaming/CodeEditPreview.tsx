import { useMemo, useState } from "react";
import type { CodeEditAnimationChunk } from "../../hooks/useCodeEditAnimation.js";
import { useCodeEditAnimation } from "../../hooks/useCodeEditAnimation.js";
import { useEventById } from "../../hooks/useEventById.js";
import {
  buildAnimationChunks,
  detectLanguageFromPath,
  parseCodeEditPayload,
  speedToCharsPerSecond,
  sumChunkTextLength,
} from "../../lib/code-edit-events.js";
import { cn } from "../../lib/cn.js";
import { useUiStore } from "../../state/ui-store.js";
import { FilePane } from "./FilePane.js";

export interface CodeEditPreviewProps {
  eventId: string;
  runId: string;
  compact?: boolean | undefined;
}

const LARGE_EDIT_THRESHOLD = 20_000;
const LARGE_EDIT_ANIMATE_LIMIT = 2_000;

function trimChunks(chunks: readonly CodeEditAnimationChunk[], limit: number): CodeEditAnimationChunk[] {
  const out: CodeEditAnimationChunk[] = [];
  let remaining = limit;
  for (const chunk of chunks) {
    if (remaining <= 0) break;
    const insertText = chunk.insertText ?? "";
    const nextText = insertText.slice(0, remaining);
    remaining -= nextText.length;
    out.push({
      path: chunk.path,
      startOffset: chunk.startOffset,
      ...(chunk.deleteText !== undefined ? { deleteText: chunk.deleteText } : {}),
      ...(nextText.length > 0 ? { insertText: nextText } : {}),
    });
  }
  return out;
}

export function CodeEditPreview({ eventId, runId, compact }: CodeEditPreviewProps) {
  const [animateLarge, setAnimateLarge] = useState(false);
  const event = useEventById(runId, eventId);
  const replaySpeed = useUiStore((s) => s.replaySpeedByRunId[runId] ?? "1x");
  const replayPaused = useUiStore((s) => s.replayPausedByRunId[runId] ?? false);
  const payload = useMemo(() => parseCodeEditPayload(event?.payload), [event?.payload]);
  const baseChunks = useMemo(() => (payload ? buildAnimationChunks(payload) : []), [payload]);
  const totalLength = useMemo(() => sumChunkTextLength(baseChunks), [baseChunks]);
  const isLargeEdit = totalLength > LARGE_EDIT_THRESHOLD;
  const chunks = useMemo(
    () => (isLargeEdit ? trimChunks(baseChunks, LARGE_EDIT_ANIMATE_LIMIT) : baseChunks),
    [baseChunks, isLargeEdit],
  );
  const effectiveTotalLength = isLargeEdit ? Math.min(totalLength, LARGE_EDIT_ANIMATE_LIMIT) : totalLength;
  const animation = useCodeEditAnimation({
    eventId: `${eventId}:${isLargeEdit && animateLarge ? "large-animated" : "default"}`,
    chunks,
    enabled: !replayPaused,
    charsPerSecond: isLargeEdit && !animateLarge ? Infinity : speedToCharsPerSecond(replaySpeed),
    totalLength: effectiveTotalLength,
  });

  if (!payload) {
    return <div className="code-edit-empty">No code edit payload available.</div>;
  }

  return (
    <div className={cn("code-edit-preview", compact && "code-edit-preview--compact")}>
      {isLargeEdit ? (
        <div className="code-edit-large">
          <span>{totalLength.toLocaleString()} chars; showing first {LARGE_EDIT_ANIMATE_LIMIT.toLocaleString()} in chunked mode.</span>
          <button type="button" onClick={() => setAnimateLarge((value) => !value)}>
            {animateLarge ? "show chunked preview" : "animate first 2,000 chars"}
          </button>
        </div>
      ) : null}
      {payload.edits.map((edit, index) => {
        const text = animation.visibleBuffersByPath[edit.path] ?? "";
        const language = detectLanguageFromPath(edit.path, edit.language);
        return (
          <FilePane
            key={`${edit.path}:${index.toString()}`}
            path={edit.path}
            language={language}
            text={text}
            caretOffset={animation.caretOffsetByPath[edit.path]}
            deletedText={edit.before && edit.before !== edit.after ? edit.before : undefined}
            compact={compact}
          />
        );
      })}
    </div>
  );
}
