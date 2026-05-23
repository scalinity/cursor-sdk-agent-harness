import { useEffect, useMemo, useRef, useState } from "react";

export interface CodeEditAnimationChunk {
  path: string;
  startOffset: number;
  deleteText?: string | undefined;
  insertText?: string | undefined;
  initialText?: string | undefined;
}

export interface CodeEditAnimationInput {
  eventId: string;
  chunks: CodeEditAnimationChunk[];
  enabled: boolean;
  charsPerSecond: number;
  totalLength: number;
}

export interface CodeEditAnimationState {
  visibleBuffersByPath: Record<string, string>;
  caretOffsetByPath: Record<string, number>;
  isComplete: boolean;
}

interface QueueState {
  chunkIndex: number;
  charIndex: number;
  charBudget: number;
  lastFrameTime: number | null;
  buffersByPath: Record<string, string>;
  caretOffsetByPath: Record<string, number>;
}

const LARGE_EDIT_THRESHOLD = 20_000;
const EMPTY_STATE: CodeEditAnimationState = {
  visibleBuffersByPath: {},
  caretOffsetByPath: {},
  isComplete: true,
};

function chunkSignature(chunks: readonly CodeEditAnimationChunk[]): string {
  return chunks
    .map((chunk) =>
      [chunk.path, chunk.startOffset, chunk.deleteText ?? "", chunk.insertText ?? "", chunk.initialText ?? ""].join("\u0000"),
    )
    .join("\u0001");
}

function applyDeletion(buffer: string, startOffset: number, deleteText: string | undefined): string {
  if (deleteText === undefined || deleteText.length === 0) return buffer;
  const start = Math.min(Math.max(startOffset, 0), buffer.length);
  return buffer.slice(0, start) + buffer.slice(start + deleteText.length);
}

function insertAt(buffer: string, startOffset: number, text: string): string {
  const start = Math.min(Math.max(startOffset, 0), buffer.length);
  return buffer.slice(0, start) + text + buffer.slice(start);
}

function applyAll(chunks: readonly CodeEditAnimationChunk[]): CodeEditAnimationState {
  const buffersByPath: Record<string, string> = {};
  const caretOffsetByPath: Record<string, number> = {};
  for (const chunk of chunks) {
    const previous = buffersByPath[chunk.path] ?? chunk.initialText ?? "";
    const afterDelete = applyDeletion(previous, chunk.startOffset, chunk.deleteText);
    const afterInsert = chunk.insertText ? insertAt(afterDelete, chunk.startOffset, chunk.insertText) : afterDelete;
    buffersByPath[chunk.path] = afterInsert;
    caretOffsetByPath[chunk.path] = chunk.startOffset + (chunk.insertText?.length ?? 0);
  }
  return { visibleBuffersByPath: buffersByPath, caretOffsetByPath, isComplete: true };
}

function initialQueue(chunks: readonly CodeEditAnimationChunk[]): QueueState {
  const buffersByPath: Record<string, string> = {};
  const caretOffsetByPath: Record<string, number> = {};
  for (const chunk of chunks) {
    if (!(chunk.path in buffersByPath)) {
      buffersByPath[chunk.path] = chunk.initialText ?? "";
      caretOffsetByPath[chunk.path] = 0;
    }
  }
  return {
    chunkIndex: 0,
    charIndex: 0,
    charBudget: 0,
    lastFrameTime: null,
    buffersByPath,
    caretOffsetByPath,
  };
}

function stateFromQueue(queue: QueueState, isComplete: boolean): CodeEditAnimationState {
  return {
    visibleBuffersByPath: queue.buffersByPath,
    caretOffsetByPath: queue.caretOffsetByPath,
    isComplete,
  };
}

function stepQueue(
  queue: QueueState,
  chunks: readonly CodeEditAnimationChunk[],
  revealCount: number,
): { queue: QueueState; complete: boolean } {
  const next: QueueState = {
    ...queue,
    buffersByPath: { ...queue.buffersByPath },
    caretOffsetByPath: { ...queue.caretOffsetByPath },
  };
  let remaining = revealCount;

  while (remaining > 0 && next.chunkIndex < chunks.length) {
    const chunk = chunks[next.chunkIndex]!;
    if (next.charIndex === 0 && chunk.deleteText) {
      next.buffersByPath[chunk.path] = applyDeletion(
        next.buffersByPath[chunk.path] ?? "",
        chunk.startOffset,
        chunk.deleteText,
      );
      next.caretOffsetByPath[chunk.path] = chunk.startOffset;
    }

    const insertText = chunk.insertText ?? "";
    if (insertText.length === 0) {
      next.chunkIndex += 1;
      next.charIndex = 0;
      continue;
    }

    const take = Math.min(remaining, insertText.length - next.charIndex);
    const text = insertText.slice(next.charIndex, next.charIndex + take);
    const insertOffset = chunk.startOffset + next.charIndex;
    next.buffersByPath[chunk.path] = insertAt(next.buffersByPath[chunk.path] ?? "", insertOffset, text);
    next.charIndex += take;
    next.caretOffsetByPath[chunk.path] = insertOffset + take;
    remaining -= take;

    if (next.charIndex >= insertText.length) {
      next.chunkIndex += 1;
      next.charIndex = 0;
    }
  }

  return { queue: next, complete: next.chunkIndex >= chunks.length };
}

export function useCodeEditAnimation(input: CodeEditAnimationInput): CodeEditAnimationState {
  const signature = useMemo(
    () => `${input.eventId}:${input.totalLength.toString()}:${chunkSignature(input.chunks)}`,
    [input.eventId, input.totalLength, input.chunks],
  );
  const chunksRef = useRef(input.chunks);
  chunksRef.current = input.chunks;
  const charsPerSecondRef = useRef(input.charsPerSecond);
  charsPerSecondRef.current = input.charsPerSecond;
  const queueRef = useRef<QueueState | null>(null);
  const rafRef = useRef<number | null>(null);
  const [state, setState] = useState<CodeEditAnimationState>(() =>
    input.chunks.length === 0 ? EMPTY_STATE : stateFromQueue(initialQueue(input.chunks), false),
  );

  useEffect(() => {
    const chunks = chunksRef.current;
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    if (chunks.length === 0) {
      queueRef.current = null;
      setState(EMPTY_STATE);
      return;
    }

    if (input.totalLength > LARGE_EDIT_THRESHOLD || charsPerSecondRef.current === Infinity) {
      queueRef.current = null;
      setState(applyAll(chunks));
      return;
    }

    const queue = initialQueue(chunks);
    queueRef.current = queue;
    setState(stateFromQueue(queue, false));
  }, [signature, input.totalLength]);

  useEffect(() => {
    const queue = queueRef.current;
    if (queue !== null) queue.lastFrameTime = null;
  }, [input.enabled, input.charsPerSecond]);

  useEffect(() => {
    if (input.charsPerSecond !== Infinity || state.isComplete) return;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    queueRef.current = null;
    setState(applyAll(chunksRef.current));
  }, [input.charsPerSecond, state.isComplete]);

  useEffect(() => {
    if (!input.enabled || state.isComplete || input.charsPerSecond === Infinity) return;

    const tick = (time: number): void => {
      const queue = queueRef.current;
      if (queue === null) return;
      if (queue.lastFrameTime === null) {
        queue.lastFrameTime = time;
        rafRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const deltaMs = Math.max(0, time - queue.lastFrameTime);
      queue.lastFrameTime = time;
      queue.charBudget += (deltaMs / 1_000) * charsPerSecondRef.current;
      const available = Math.floor(queue.charBudget);
      if (available <= 0) {
        rafRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const revealCount = Math.min(Math.max(available, 1), 8);
      queue.charBudget -= revealCount;
      const chunks = chunksRef.current;
      const stepped = stepQueue(queue, chunks, revealCount);
      queueRef.current = stepped.queue;
      setState(stateFromQueue(stepped.queue, stepped.complete));

      if (!stepped.complete) {
        rafRef.current = window.requestAnimationFrame(tick);
      }
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [input.enabled, input.charsPerSecond, signature, state.isComplete]);

  return state;
}
