import {
  applyTextEvent,
  flattenEventChunks,
  type CanonicalRunEvent,
  type RunEventState,
} from "../state/run-store.js";

function textPayload(payload: unknown): { text_delta?: string | undefined } | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  return payload as { text_delta?: string | undefined };
}

function thinkingDurationFromPayload(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value = (payload as { thinking_duration_ms?: unknown }).thinking_duration_ms;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function deriveTextForSeqRange(
  events: ReadonlyArray<CanonicalRunEvent>,
  source: "assistant" | "thinking",
  startSeq: number,
  endSeq: number,
): string {
  let text = "";
  for (const evt of events) {
    if (evt.seq < startSeq || evt.seq > endSeq) continue;
    if (evt.sdk_type !== source) continue;
    text = applyTextEvent(text, evt.kind, textPayload(evt.payload));
  }
  return text;
}

/** Hot-path variant: walks sorted seqList and looks up events in bySeq. */
export function deriveTextForSeqRangeFromRunState(
  runState: Pick<RunEventState, "seqList" | "bySeq">,
  source: "assistant" | "thinking",
  startSeq: number,
  endSeq: number,
): string {
  let text = "";
  for (const seq of runState.seqList) {
    if (seq < startSeq) continue;
    if (seq > endSeq) break;
    const evt = runState.bySeq.get(seq);
    if (!evt || evt.sdk_type !== source) continue;
    text = applyTextEvent(text, evt.kind, textPayload(evt.payload));
  }
  return text;
}

export function deriveThinkingDurationForSeqRange(
  runState: Pick<RunEventState, "seqList" | "bySeq">,
  startSeq: number,
  endSeq: number,
): number | null {
  let durationMs: number | null = null;
  for (const seq of runState.seqList) {
    if (seq < startSeq) continue;
    if (seq > endSeq) break;
    const evt = runState.bySeq.get(seq);
    if (!evt || evt.sdk_type !== "thinking") continue;
    const duration = thinkingDurationFromPayload(evt.payload);
    if (duration !== null) durationMs = duration;
  }
  return durationMs;
}

function callIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const callId = (payload as { call_id?: unknown }).call_id;
  return typeof callId === "string" ? callId : null;
}

export type TimelineSegment =
  | { type: "system"; event: CanonicalRunEvent; key: string }
  | { type: "user"; event: CanonicalRunEvent; key: string }
  | { type: "thinking"; startSeq: number; endSeq: number; anchorEvent: CanonicalRunEvent; key: string }
  | { type: "assistant"; startSeq: number; endSeq: number; anchorEvent: CanonicalRunEvent; key: string }
  | { type: "tool_call_group"; callIds: readonly string[]; startSeq: number; endSeq: number; key: string }
  | { type: "code_edit"; event: CanonicalRunEvent; key: string }
  | { type: "approval"; event: CanonicalRunEvent; key: string }
  | { type: "fallback"; event: CanonicalRunEvent; key: string };

export function buildTimelineSegments(
  eventChunks: ReadonlyArray<ReadonlyArray<CanonicalRunEvent>>,
): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  const events = flattenEventChunks(eventChunks);

  let assistantStart: number | null = null;
  let assistantEnd: number | null = null;
  let assistantAnchor: CanonicalRunEvent | null = null;

  let thinkingStart: number | null = null;
  let thinkingEnd: number | null = null;
  let thinkingAnchor: CanonicalRunEvent | null = null;

  let toolCallIds: string[] = [];
  let toolStart: number | null = null;
  let toolEnd: number | null = null;
  const toolCallIdSet = new Set<string>();

  const flushAssistant = (): void => {
    if (assistantStart !== null && assistantAnchor) {
      segments.push({
        type: "assistant",
        startSeq: assistantStart,
        endSeq: assistantEnd ?? assistantStart,
        anchorEvent: assistantAnchor,
        key: `assistant-${assistantStart}`,
      });
    }
    assistantStart = null;
    assistantEnd = null;
    assistantAnchor = null;
  };

  const flushThinking = (): void => {
    if (thinkingStart !== null && thinkingAnchor) {
      segments.push({
        type: "thinking",
        startSeq: thinkingStart,
        endSeq: thinkingEnd ?? thinkingStart,
        anchorEvent: thinkingAnchor,
        key: `thinking-${thinkingStart}`,
      });
    }
    thinkingStart = null;
    thinkingEnd = null;
    thinkingAnchor = null;
  };

  const flushTools = (): void => {
    if (toolCallIds.length > 0 && toolStart !== null) {
      segments.push({
        type: "tool_call_group",
        callIds: toolCallIds,
        startSeq: toolStart,
        endSeq: toolEnd ?? toolStart,
        key: `tools-${toolStart}`,
      });
    }
    toolCallIds = [];
    toolStart = null;
    toolEnd = null;
    toolCallIdSet.clear();
  };

  const addToolCall = (evt: CanonicalRunEvent): void => {
    const callId = callIdFromPayload(evt.payload);
    if (!callId) return;
    if (toolStart === null) toolStart = evt.seq;
    toolEnd = evt.seq;
    if (!toolCallIdSet.has(callId)) {
      toolCallIdSet.add(callId);
      toolCallIds.push(callId);
    }
  };

  for (const evt of events) {
    switch (evt.sdk_type) {
      case "system":
        flushAssistant();
        flushThinking();
        flushTools();
        segments.push({ type: "system", event: evt, key: evt.event_id });
        break;
      case "user":
        flushAssistant();
        flushThinking();
        flushTools();
        segments.push({ type: "user", event: evt, key: evt.event_id });
        break;
      case "thinking":
        flushAssistant();
        flushTools();
        if (thinkingStart === null) {
          thinkingStart = evt.seq;
          thinkingAnchor = evt;
        }
        thinkingEnd = evt.seq;
        break;
      case "assistant":
        flushThinking();
        flushTools();
        if (assistantStart === null) {
          assistantStart = evt.seq;
          assistantAnchor = evt;
        }
        assistantEnd = evt.seq;
        break;
      case "tool_call":
        if (evt.kind === "code_edit.detected") {
          flushAssistant();
          flushThinking();
          flushTools();
          segments.push({ type: "code_edit", event: evt, key: evt.event_id });
        } else if (evt.kind.startsWith("tool_call.")) {
          flushAssistant();
          flushThinking();
          addToolCall(evt);
        }
        break;
      case "request":
        flushAssistant();
        flushThinking();
        flushTools();
        if (
          evt.kind === "request.created" ||
          evt.kind === "approval.resolved" ||
          evt.kind === "approval.failed"
        ) {
          segments.push({ type: "approval", event: evt, key: evt.event_id });
        }
        break;
      case "status":
        break;
      default:
        flushAssistant();
        flushThinking();
        flushTools();
        segments.push({ type: "fallback", event: evt, key: evt.event_id });
        break;
    }
  }

  flushAssistant();
  flushThinking();
  flushTools();
  return segments;
}
