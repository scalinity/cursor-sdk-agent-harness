import { useEffect, useMemo, useRef, useState } from "react";
import {
  createMarkdownProjector,
  type MarkdownBlock,
} from "../lib/streaming-markdown-projector.js";
import { publishStreamingText } from "../lib/streaming-text-channel.js";
import { useRunStore } from "../state/run-store.js";
import { useErrorReporter } from "./useErrorReporter.js";

export interface UseStreamingMarkdownInput {
  runId: string;
  source: "assistant" | "thinking";
}

export interface UseStreamingMarkdownResult {
  blocks: MarkdownBlock[];
  fallbackText: string | null;
}

function textForRun(runId: string, source: "assistant" | "thinking"): string {
  const state = useRunStore.getState().eventsByRunId[runId];
  if (!state) return "";
  return source === "assistant" ? state.assistantText : state.thinkingText;
}

function streamIdFor(input: UseStreamingMarkdownInput, id: string): string {
  return `${input.runId}:${input.source}:${id}`;
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
    () => ({ runId: input.runId, source: input.source }),
    [input.runId, input.source],
  );
  const lastTextRef = useRef("");
  const fallbackModeRef = useRef(false);
  const generationRef = useRef(0);
  const rafIdsRef = useRef<number[]>([]);
  const [blocks, setBlocks] = useState<MarkdownBlock[]>([]);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const { report } = useErrorReporter(`streaming-markdown-${scope.source}`);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    for (const rafId of rafIdsRef.current) window.cancelAnimationFrame(rafId);
    rafIdsRef.current = [];
    fallbackModeRef.current = false;
    lastTextRef.current = "";
    projector.reset();
    setBlocks([]);
    setFallbackText(null);

    const scheduleStructuralPublish = (nextBlocks: MarkdownBlock[]): void => {
      const rafId = window.requestAnimationFrame(() => {
        rafIdsRef.current = rafIdsRef.current.filter((id) => id !== rafId);
        if (generationRef.current !== generation) return;
        for (const block of nextBlocks) publishBlockText(scope, block);
      });
      rafIdsRef.current.push(rafId);
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
          scheduleStructuralPublish(nextBlocks);
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

    applyText(textForRun(scope.runId, scope.source));
    const unsubscribe = useRunStore.subscribe((state, prevState) => {
      const nextRun = state.eventsByRunId[scope.runId];
      const prevRun = prevState.eventsByRunId[scope.runId];
      const nextText = scope.source === "assistant" ? nextRun?.assistantText : nextRun?.thinkingText;
      const prevText = scope.source === "assistant" ? prevRun?.assistantText : prevRun?.thinkingText;
      if ((nextText ?? "") === (prevText ?? "")) return;
      applyText(nextText ?? "");
    });
    return () => {
      unsubscribe();
      generationRef.current += 1;
      for (const rafId of rafIdsRef.current) window.cancelAnimationFrame(rafId);
      rafIdsRef.current = [];
    };
  }, [projector, report, scope]);

  return { blocks, fallbackText };
}
