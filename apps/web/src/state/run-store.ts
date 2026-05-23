/**
 * Run store — the canonical event log on the client.
 *
 * The store is append-only. `ingestServerFrame` is the SOLE entry point
 * for SDK / derived event frames; it updates the per-run seq list, the
 * fast `bySeq` lookup, the text accumulators, and the run-level final
 * result / interrupted state. Components subscribe to slices via Zustand
 * selectors and never mutate state outside actions.
 *
 * `bySeq` is a plain Map (not a Record) because seq numbers are sparse
 * during gap recovery and the lookup is hot during replay drainage.
 */
import type {
  CanonicalEventBase,
  RunSummary,
  ServerFrame,
  SdkRunStatus,
  TokenUsage,
  UsageSource,
} from "@harness/shared";
import { create } from "zustand";

/**
 * The shape of every canonical event the client knows about. We type the
 * payload as `unknown` here — the discriminated frame schema in
 * `@harness/shared` provides type-narrowed payloads at the consumer site
 * (the renderer), and the store deliberately does not constrain payload
 * shape so we can replay events without re-validating.
 */
export interface CanonicalRunEvent extends CanonicalEventBase {
  sdk_type:
    | "system"
    | "user"
    | "assistant"
    | "thinking"
    | "tool_call"
    | "status"
    | "task"
    | "request";
  kind: string;
  payload: unknown;
  /** True if this frame was sent during after_seq replay. */
  replayed?: boolean;
}

export interface RunRecord {
  id: string;
  agentId: string;
  status: SdkRunStatus | null;
  startedAt: string | null;
  finishedAt: string | null;
  finalText: string | null;
  interruptedReason: string | null;
  usage: TokenUsage | null;
  usageSource: UsageSource | null;
  /** Set when `run.final_result` arrives. */
  durationMs: number | null;
}

export interface RunEventState {
  seqList: number[];
  bySeq: Map<number, CanonicalRunEvent>;
  lastSeq: number;
  /** Concatenated assistant text from delta/snapshot events. */
  assistantText: string;
  /** Concatenated thinking text from delta/snapshot events. */
  thinkingText: string;
}

export interface RunState {
  byId: Record<string, RunRecord>;
  eventsByRunId: Record<string, RunEventState>;
  activeRunId: string | null;

  ingestServerFrame: (frame: ServerFrame, options?: { replayed?: boolean }) => void;
  upsertRunSummary: (summary: RunSummary) => void;
  setActiveRunId: (runId: string | null) => void;
  resetRun: (runId: string) => void;
  setRunStatus: (runId: string, status: SdkRunStatus | null) => void;
}

function emptyEventState(): RunEventState {
  return {
    seqList: [],
    bySeq: new Map(),
    lastSeq: 0,
    assistantText: "",
    thinkingText: "",
  };
}

function ensureRunRecord(byId: Record<string, RunRecord>, runId: string, agentId: string): RunRecord {
  const existing = byId[runId];
  if (existing) return existing;
  return {
    id: runId,
    agentId,
    status: null,
    startedAt: null,
    finishedAt: null,
    finalText: null,
    interruptedReason: null,
    usage: null,
    usageSource: null,
    durationMs: null,
  };
}

/**
 * Apply a delta or snapshot to a running text accumulator. We mirror the
 * server-side prefix-match strategy:
 *   - Snapshot with `is_replacement: true` → replace.
 *   - Delta → append `text_delta`.
 *   - Snapshot with `is_replacement: false` → keep the new text (treated as the
 *     authoritative value, matches server-side semantics).
 */
function applyTextEvent(
  prev: string,
  kind: string,
  payload: { text_delta?: string | undefined; is_replacement?: boolean | undefined } | null,
): string {
  if (!payload) return prev;
  const isSnapshot = kind.endsWith(".snapshot");
  const isReplacement = payload.is_replacement === true;
  const delta = payload.text_delta ?? "";
  if (isSnapshot && isReplacement) return delta;
  if (isSnapshot) return delta;
  // delta
  return prev + delta;
}

export const useRunStore = create<RunState>((set) => ({
  byId: {},
  eventsByRunId: {},
  activeRunId: null,

  ingestServerFrame: (frame, options) => {
    set((state) => {
      // Acks and heartbeats don't carry events.
      if (frame.type === "ack" || frame.type === "heartbeat" || frame.type === "error") {
        return state;
      }

      const evt = frame.event;
      const runId = evt.run_id;
      const agentId = evt.agent_id;
      const replayed = options?.replayed ?? false;

      // Defensive copy of event state so we never mutate the prior snapshot.
      const prevEvents = state.eventsByRunId[runId];
      const nextEvents: RunEventState = prevEvents
        ? {
            seqList: prevEvents.seqList,
            bySeq: prevEvents.bySeq,
            lastSeq: prevEvents.lastSeq,
            assistantText: prevEvents.assistantText,
            thinkingText: prevEvents.thinkingText,
          }
        : emptyEventState();

      // Skip duplicates (replay edge cases where we already saw a seq).
      if (nextEvents.bySeq.has(evt.seq)) {
        return state;
      }

      const canonical: CanonicalRunEvent = {
        event_id: evt.event_id,
        schema_version: evt.schema_version,
        seq: evt.seq,
        agent_id: evt.agent_id,
        run_id: evt.run_id,
        occurred_at: evt.occurred_at,
        received_at: evt.received_at,
        sdk_type: evt.sdk_type,
        kind: evt.kind,
        payload: evt.payload,
        replayed,
      };

      // Append to seqList preserving order. In practice frames arrive in
      // order (per-run bus) and we only handle the rare out-of-order case
      // by binary-inserting; keep it simple by sorting on the rare case.
      const newSeqList = [...nextEvents.seqList, evt.seq];
      if (newSeqList.length > 1 && newSeqList[newSeqList.length - 2]! > evt.seq) {
        newSeqList.sort((a, b) => a - b);
      }
      const newBySeq = new Map(nextEvents.bySeq);
      newBySeq.set(evt.seq, canonical);

      nextEvents.seqList = newSeqList;
      nextEvents.bySeq = newBySeq;
      nextEvents.lastSeq = Math.max(nextEvents.lastSeq, evt.seq);

      // Text accumulators.
      if (frame.type === "sdk.assistant") {
        nextEvents.assistantText = applyTextEvent(
          nextEvents.assistantText,
          frame.event.kind,
          frame.event.payload,
        );
      } else if (frame.type === "sdk.thinking") {
        nextEvents.thinkingText = applyTextEvent(
          nextEvents.thinkingText,
          frame.event.kind,
          frame.event.payload,
        );
      }

      // Run-level projections.
      const nextById = { ...state.byId };
      const run = { ...ensureRunRecord(nextById, runId, agentId) };
      if (frame.type === "sdk.status") {
        run.status = frame.event.payload.status;
      } else if (frame.type === "run.final_result") {
        run.status = "FINISHED";
        run.finalText = frame.event.payload.text ?? run.finalText;
        run.durationMs = frame.event.payload.duration_ms ?? run.durationMs;
        run.finishedAt = evt.occurred_at;
        run.usage = frame.event.payload.usage ?? null;
        run.usageSource = frame.event.payload.usage?.usage_source ?? null;
      } else if (frame.type === "run.interrupted") {
        run.interruptedReason = frame.event.payload.reason;
        run.finishedAt = evt.occurred_at;
      }
      nextById[runId] = run;

      return {
        ...state,
        byId: nextById,
        eventsByRunId: { ...state.eventsByRunId, [runId]: nextEvents },
      };
    });
  },

  upsertRunSummary: (summary) => {
    set((state) => {
      const existing = state.byId[summary.id];
      const updated: RunRecord = {
        id: summary.id,
        agentId: summary.agentId,
        status: summary.status,
        startedAt: summary.startedAt,
        finishedAt: summary.finishedAt,
        finalText: existing?.finalText ?? null,
        interruptedReason: existing?.interruptedReason ?? null,
        durationMs: summary.durationMs,
        usage:
          summary.inputTokens !== null
            ? {
                input_tokens: summary.inputTokens,
                output_tokens: summary.outputTokens,
                cached_input_tokens: summary.cachedInputTokens,
                reasoning_tokens: summary.reasoningTokens,
                cost_usd_micros: summary.costUsdMicros,
                usage_source: summary.usageSource ?? "unavailable",
              }
            : null,
        usageSource: summary.usageSource,
      };
      return { ...state, byId: { ...state.byId, [summary.id]: updated } };
    });
  },

  setActiveRunId: (runId) => set({ activeRunId: runId }),

  resetRun: (runId) => {
    set((state) => {
      const nextEvents = { ...state.eventsByRunId };
      delete nextEvents[runId];
      return { ...state, eventsByRunId: nextEvents };
    });
  },

  setRunStatus: (runId, status) => {
    set((state) => {
      const existing = state.byId[runId];
      if (!existing) return state;
      return {
        ...state,
        byId: { ...state.byId, [runId]: { ...existing, status } },
      };
    });
  },
}));
