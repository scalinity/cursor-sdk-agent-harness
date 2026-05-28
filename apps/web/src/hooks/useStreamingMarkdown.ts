import { useEffect, useMemo, useRef, useState } from "react";
import {
  createMarkdownProjector,
  type MarkdownBlock,
} from "../lib/streaming-markdown-projector.js";
import { deriveTextForSeqRangeFromRunState } from "../lib/timeline-segments.js";
import { publishStreamingText } from "../lib/streaming-text-channel.js";
import { useRunStore } from "../state/run-store.js";
import { useErrorReporter } from "./useErrorReporter.js";

export interface UseStreamingMarkdownInput {
  runId: string;
  source: "assistant" | "thinking";
  /** When set, only text from events in [startSeq, endSeq] is rendered. */
  startSeq?: number | undefined;
  endSeq?: number | undefined;
}

export interface UseStreamingMarkdownResult {
  blocks: MarkdownBlock[];
  fallbackText: string | null;
}

function textForRun(input: UseStreamingMarkdownInput): string {
  const state = useRunStore.getState().eventsByRunId[input.runId];
  if (!state) return "";
  if (input.startSeq !== undefined && input.endSeq !== undefined) {
    return deriveTextForSeqRangeFromRunState(state, input.source, input.startSeq, input.endSeq);
  }
  return input.source === "assistant" ? state.assistantText : state.thinkingText;
}

function streamIdFor(input: UseStreamingMarkdownInput, id: string): string {
  const range =
    input.startSeq !== undefined && input.endSeq !== undefined
      ? `:${input.startSeq}-${input.endSeq}`
      : "";
  return `${input.runId}:${input.source}${range}:${id}`;
}

function publishBlockText(input: UseStreamingMarkdownInput, block: MarkdownBlock): void {
  if (block.type === "paragraph" || block.type === "heading" || block.type === "blockquote") {
    publishStreamingText(streamIdFor(input, block.id), { text: block.text, isReplacement: true });
    return;
  }
  if (block.type === "code") {
    publishStreamingText(streamIdFor(input, block.id), { text: block.text, isReplacement: true });
    return;
  }
  if (block.type === "list") {
    for (const item of block.items) {
      publishStreamingText(streamIdFor(input, item.id), { text: item.text, isReplacement: true });
    }
  }
}

function publishTextByIds(input: UseStreamingMarkdownInput, blocks: MarkdownBlock[], ids: readonly string[]): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  for (const block of blocks) {
    if (idSet.has(block.id)) publishBlockText(input, block);
    if (block.type === "list") {
      for (const item of block.items) {
        if (idSet.has(item.id) || idSet.has(block.id)) {
          publishStreamingText(streamIdFor(input, item.id), { text: item.text, isReplacement: true });
        }
      }
    }
  }
}

function includesCodeBlock(blocks: MarkdownBlock[], ids: readonly string[]): boolean {
  if (ids.length === 0) return false;
  const idSet = new Set(ids);
  return blocks.some((block) => block.type === "code" && idSet.has(block.id));
}

export function useStreamingMarkdown(input: UseStreamingMarkdownInput): UseStreamingMarkdownResult {
  const projector = useMemo(() => createMarkdownProjector(), []);
  const scope = useMemo(
    () => ({
      runId: input.runId,
      source: input.source,
      startSeq: input.startSeq,
      endSeq: input.endSeq,
    }),
    [input.endSeq, input.runId, input.source, input.startSeq],
  );
  const lastTextRef = useRef("");
  const fallbackModeRef = useRef(false);
  const [blocks, setBlocks] = useState<MarkdownBlock[]>([]);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const { report } = useErrorReporter(`streaming-markdown-${scope.source}`);

  useEffect(() => {
    fallbackModeRef.current = false;
    lastTextRef.current = "";
    projector.reset();
    setBlocks([]);
    setFallbackText(null);

    const publishStructural = (nextBlocks: MarkdownBlock[]): void => {
      // F-006: was a RAF-deferred publish. The RAF callback closed over
      // a stale `nextBlocks` snapshot; if a non-structural applyText ran
      // before the RAF fired, the deferred publish would overwrite the
      // channel buffer with the older text and the late StreamingText
      // subscriber would see e.g. "STREAM" instead of "STREAMING WORKS".
      // Publishing synchronously preserves write order without breaking
      // the React commit (publishStreamingText is cheap — sets a Map
      // entry and notifies any current listeners).
      for (const block of nextBlocks) publishBlockText(scope, block);
    };

    const applyText = (nextText: string): void => {
      if (fallbackModeRef.current) {
        lastTextRef.current = nextText;
        setFallbackText(nextText);
        if (nextText.length === 0) {
          fallbackModeRef.current = false;
          projector.reset();
          setBlocks([]);
          setFallbackText(null);
        }
        return;
      }
      try {
        if (nextText.length === 0) {
          lastTextRef.current = "";
          projector.reset();
          setBlocks([]);
          setFallbackText(null);
          return;
        }

        const previous = lastTextRef.current;
        const isAppend = nextText.startsWith(previous);
        const chunk = isAppend ? nextText.slice(previous.length) : nextText;
        if (!isAppend) {
          projector.reset();
          setBlocks([]);
        }
        if (chunk.length === 0) return;

        const result = projector.write(chunk);
        lastTextRef.current = nextText;
        const nextBlocks = projector.getBlocks();
        if (result.structural) {
          setBlocks(nextBlocks);
          publishStructural(nextBlocks);
        } else {
          if (includesCodeBlock(nextBlocks, result.textBlockIds)) setBlocks(nextBlocks);
          publishTextByIds(scope, nextBlocks, result.textBlockIds);
        }
      } catch (err) {
        report(err);
        fallbackModeRef.current = true;
        lastTextRef.current = nextText;
        setFallbackText(nextText);
      }
    };

    applyText(textForRun(scope));
    const unsubscribe = useRunStore.subscribe((state, prevState) => {
      const nextRun = state.eventsByRunId[scope.runId];
      const prevRun = prevState.eventsByRunId[scope.runId];
      if (scope.startSeq !== undefined && scope.endSeq !== undefined) {
        if ((nextRun?.eventsVersion ?? 0) === (prevRun?.eventsVersion ?? 0)) return;
      } else {
        const nextText = scope.source === "assistant" ? nextRun?.assistantText : nextRun?.thinkingText;
        const prevText = scope.source === "assistant" ? prevRun?.assistantText : prevRun?.thinkingText;
        if ((nextText ?? "") === (prevText ?? "")) return;
      }
      applyText(textForRun(scope));
    });
    return () => {
      unsubscribe();
    };
  }, [projector, report, scope]);

  return { blocks, fallbackText };
}
