import { codeEditDetectedPayloadSchema, type KnownLanguage, type ReplaySpeed } from "@harness/shared";
import type { z } from "zod";
import type { CanonicalRunEvent } from "../state/run-store.js";
import type { CodeEditAnimationChunk } from "../hooks/useCodeEditAnimation.js";

export const codeEditPayloadSchema = codeEditDetectedPayloadSchema;
export type CodeEditPayload = z.infer<typeof codeEditPayloadSchema>;
export type CodeEditFile = CodeEditPayload["edits"][number];

export function isCodeEditEvent(event: CanonicalRunEvent): boolean {
  return event.sdk_type === "tool_call" && event.kind === "code_edit.detected";
}

export function parseCodeEditPayload(payload: unknown): CodeEditPayload | null {
  const parsed = codeEditPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function codeEditEventsForRun(events: readonly CanonicalRunEvent[]): CanonicalRunEvent[] {
  return events.filter(isCodeEditEvent);
}

export function findCodeEditEventForCall(
  events: readonly CanonicalRunEvent[],
  callId: string,
): CanonicalRunEvent | null {
  for (const event of events) {
    if (!isCodeEditEvent(event)) continue;
    const payload = parseCodeEditPayload(event.payload);
    if (payload?.source_call_id === callId) return event;
  }
  return null;
}

export function detectLanguageFromPath(path: string, fallback: KnownLanguage | null = null): KnownLanguage {
  if (fallback !== null) return fallback;
  if (/\.tsx?$/i.test(path)) return "typescript";
  if (/\.(?:jsx?|mjs|cjs)$/i.test(path)) return "javascript";
  if (/\.py$/i.test(path)) return "python";
  if (/\.json$/i.test(path)) return "json";
  if (/\.(?:md|mdx)$/i.test(path)) return "markdown";
  if (/\.(?:sh|bash|zsh)$/i.test(path)) return "shell";
  return "plain-text";
}

export function buildAnimationChunks(payload: CodeEditPayload): CodeEditAnimationChunk[] {
  const chunks: CodeEditAnimationChunk[] = [];
  for (const edit of payload.edits) {
    if (edit.operations.length === 0) {
      if (edit.after !== undefined) chunks.push({ path: edit.path, startOffset: 0, insertText: edit.after });
      continue;
    }

    for (const [index, operation] of edit.operations.entries()) {
      chunks.push({
        path: edit.path,
        startOffset: operation.startOffset,
        ...(index === 0 && edit.before !== undefined ? { initialText: edit.before } : {}),
        ...(operation.type !== "insert" && edit.before !== undefined
          ? { deleteText: edit.before.slice(operation.startOffset, operation.endOffset) }
          : {}),
        ...(operation.text.length > 0 ? { insertText: operation.text } : {}),
      });
    }
  }
  return chunks;
}

export function sumChunkTextLength(chunks: readonly CodeEditAnimationChunk[]): number {
  return chunks.reduce((total, chunk) => total + (chunk.insertText?.length ?? 0), 0);
}

export function speedToCharsPerSecond(speed: ReplaySpeed): number {
  if (speed === "instant") return Infinity;
  if (speed === "4x") return 480;
  if (speed === "2x") return 240;
  return 120;
}

export function selectedCodeEditEvent(
  events: readonly CanonicalRunEvent[],
  selectedEventId: string | null,
): CanonicalRunEvent | null {
  const edits = codeEditEventsForRun(events);
  if (edits.length === 0) return null;
  if (selectedEventId !== null) {
    const selected = edits.find((event) => event.event_id === selectedEventId);
    if (selected) return selected;
  }
  return edits[edits.length - 1] ?? null;
}
