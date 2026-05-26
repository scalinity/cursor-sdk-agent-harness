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
 *
 * `events` is a parallel CanonicalRunEvent[] kept in seq order — this
 * lets renderers iterate without rebuilding the array per render
 * (RV2-S5). `toolCallCount` is maintained incrementally to avoid the
 * per-render O(n) scan in CenterPane (RV2-S4).
 */
import type {
  CanonicalEventBase,
  RunInterruptedReason,
  RunSummary,
  ServerFrame,
  SdkRunStatus,
  TokenUsage,
  UsageSource,
} from "@harness/shared";
import { create } from "zustand";
import { clientPerf } from "../lib/perf-counters.js";

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
  /**
   * True if this frame was emitted during after_seq replay. The server sets
   * this on replay frames, and tests/hooks may also pass it explicitly when
   * feeding stored frames through the same ingest path.
   */
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
  /** Run's model id — drives the context-window denominator for the gauge. */
  modelId: string | null;
  /** Last turn's per-turn usage = context-occupancy estimate (see context-budget). */
  lastTurnInputTokens: number | null;
  lastTurnOutputTokens: number | null;
}

export interface ApprovalState {
  requestId: string;
  /** seq of the originating `request.created` event. */
  requestSeq: number;
  status: "pending" | "resolved" | "failed";
  decision: "approve" | "deny" | null;
  reason: string | null;
  /** ISO timestamp the resolved/failed outcome landed (server-stamped). */
  resolvedAt: string | null;
  /** Error code when status === "failed". */
  code: string | null;
  /** Error message when status === "failed". */
  message: string | null;
}

export interface RunEventState {
  seqList: number[];
  bySeq: Map<number, CanonicalRunEvent>;
  /**
   * Parallel array kept in seq order. Renderers iterate this directly so
   * the timeline component doesn't rebuild a `seqList.map(seq => bySeq.get(seq))`
   * array per render.
   */
  events: CanonicalRunEvent[];
  lastSeq: number;
  /** Concatenated assistant text from delta/snapshot events. */
  assistantText: string;
  /** Concatenated thinking text from delta/snapshot events. */
  thinkingText: string;
  /** Maintained incrementally as `sdk.tool_call` frames arrive. */
  toolCallCount: number;
  /**
   * Phase 13 — keyed by `request_id`. Tracks the latest known state of
   * each approval prompt the timeline has seen. Updated as
   * `request.created` / `approval.resolved` / `approval.failed`
   * frames arrive. Renderers query this for the ApprovalPrompt's
   * pending vs resolved vs failed-unimplemented branch.
   */
  approvalsByRequestId: Record<string, ApprovalState>;
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
    events: [],
    lastSeq: 0,
    assistantText: "",
    thinkingText: "",
    toolCallCount: 0,
    approvalsByRequestId: {},
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
    modelId: null,
    lastTurnInputTokens: null,
    lastTurnOutputTokens: null,
  };
}

/**
 * Apply a delta or snapshot to a running text accumulator. The server-side
 * normalizer emits `<role>.snapshot` events only when it has detected a
 * non-prefix rewrite (with `is_replacement: true`) — there is currently no
 * code path that produces `is_replacement: false` on a snapshot. The store
 * therefore treats every snapshot as a replacement and every delta as an
 * append; if the contract widens, this is the place to grow the branch.
 */
function applyTextEvent(
  prev: string,
  kind: string,
  payload: { text_delta?: string | undefined } | null,
): string {
  if (!payload) return prev;
  const isSnapshot = kind.endsWith(".snapshot");
  const delta = payload.text_delta ?? "";
  if (isSnapshot) return delta;
  return prev + delta;
}

/**
 * Binary-insert `seq` into the sorted `seqList` (and `events` array,
 * positioned to match the seq order). The hot path is the append case
 * where seq is greater than the last element; that short-circuits to a
 * single push. Out-of-order arrivals (rare, gap recovery) fall back to
 * binary insertion at the correct position, keeping the slot lookup
 * O(log n) instead of the previous O(n log n) Array.sort.
 */
function insertSeqInOrder(
  list: number[],
  events: CanonicalRunEvent[],
  seq: number,
  canonical: CanonicalRunEvent,
): { list: number[]; events: CanonicalRunEvent[] } {
  if (list.length === 0 || list[list.length - 1]! < seq) {
    return { list: [...list, seq], events: [...events, canonical] };
  }
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid]! < seq) lo = mid + 1;
    else hi = mid;
  }
  const nextList = list.slice();
  const nextEvents = events.slice();
  nextList.splice(lo, 0, seq);
  nextEvents.splice(lo, 0, canonical);
  return { list: nextList, events: nextEvents };
}

/**
 * Map a Phase-07 RunInterruptedReason to the matching SdkRunStatus
 * projection. `user_cancelled` → CANCELLED; everything else → ERROR.
 * Returning a null leaves the existing status alone — used when the
 * interrupted reason doesn't map cleanly to one of the SDK terminal
 * statuses.
 */
function statusFromInterruptedReason(reason: string): SdkRunStatus | null {
  if ((reason as RunInterruptedReason) === "user_cancelled") return "CANCELLED";
  if (reason === "stream_error") return "ERROR";
  if (reason === "agent_terminated") return "CANCELLED";
  if (reason === "server_restart" || reason === "server_close") return "ERROR";
  return null;
}

export const useRunStore = create<RunState>((set) => ({
  byId: {},
  eventsByRunId: {},
  activeRunId: null,

  ingestServerFrame: (frame, options) => {
    const ingestStart = performance.now();
    // P14-W3: only observe client_event_ingest_ms when the call did
    // real work. Acks/heartbeats/errors and duplicate-seq drops return
    // state unchanged; observing them pollutes the histogram with
    // sub-microsecond no-ops and makes a heartbeat-only run look like
    // "instant ingest" while a duplicate-replay storm reports inflated
    // counts. The flag is set by the set() callback on the real-ingest
    // path only.
    let didIngest = false;
    set((state) => {
      // Acks and heartbeats don't carry events.
      if (frame.type === "ack" || frame.type === "heartbeat" || frame.type === "error") {
        return state;
      }

      const evt = frame.event;
      const runId = evt.run_id;
      const agentId = evt.agent_id;
      const replayed = options?.replayed ?? frame.replayed ?? false;

      // Defensive copy of event state so we never mutate the prior snapshot.
      const prevEvents = state.eventsByRunId[runId];
      const nextEvents: RunEventState = prevEvents
        ? {
            seqList: prevEvents.seqList,
            bySeq: prevEvents.bySeq,
            events: prevEvents.events,
            lastSeq: prevEvents.lastSeq,
            assistantText: prevEvents.assistantText,
            thinkingText: prevEvents.thinkingText,
            toolCallCount: prevEvents.toolCallCount,
            approvalsByRequestId: prevEvents.approvalsByRequestId,
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

      const inserted = insertSeqInOrder(
        nextEvents.seqList,
        nextEvents.events,
        evt.seq,
        canonical,
      );
      nextEvents.seqList = inserted.list;
      nextEvents.events = inserted.events;
      const newBySeq = new Map(nextEvents.bySeq);
      newBySeq.set(evt.seq, canonical);
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
      } else if (frame.type === "sdk.tool_call") {
        // Maintain incrementally so renderers don't rescan the seqList.
        nextEvents.toolCallCount += 1;
      } else if (frame.type === "sdk.request") {
        // Phase 13 — record a pending approval prompt keyed by
        // request_id. The originating seq lets the renderer scroll
        // back to the inline location when the user clicks the
        // banner.
        //
        // RV2-W8: the `{ ...approvalsByRequestId, [reqId]: ... }`
        // spread is O(N) per request in the count of approvals
        // already seen for this run. In practice N is single-digit
        // per run (spec §4 caps pending approvals per turn; harness
        // retention bounds historical accumulation). If a future
        // protocol grows the per-run approval count meaningfully,
        // swap this for a structural-share Map or Immer-style draft.
        const reqId = frame.event.payload.request_id;
        nextEvents.approvalsByRequestId = {
          ...nextEvents.approvalsByRequestId,
          [reqId]: {
            requestId: reqId,
            requestSeq: evt.seq,
            status: "pending",
            decision: null,
            reason: null,
            resolvedAt: null,
            code: null,
            message: null,
          },
        };
      } else if (frame.type === "approval.resolved") {
        const reqId = frame.event.payload.request_id;
        const prev = nextEvents.approvalsByRequestId[reqId];
        nextEvents.approvalsByRequestId = {
          ...nextEvents.approvalsByRequestId,
          [reqId]: {
            requestId: reqId,
            requestSeq: prev?.requestSeq ?? evt.seq,
            status: "resolved",
            decision: frame.event.payload.decision,
            reason: frame.event.payload.reason ?? null,
            resolvedAt: frame.event.payload.resolved_at,
            code: null,
            message: null,
          },
        };
      } else if (frame.type === "approval.failed") {
        const reqId = frame.event.payload.request_id;
        const prev = nextEvents.approvalsByRequestId[reqId];
        nextEvents.approvalsByRequestId = {
          ...nextEvents.approvalsByRequestId,
          [reqId]: {
            requestId: reqId,
            requestSeq: prev?.requestSeq ?? evt.seq,
            status: "failed",
            decision: frame.event.payload.decision,
            reason: frame.event.payload.reason ?? null,
            resolvedAt: frame.event.payload.failed_at,
            code: frame.event.payload.code,
            message: frame.event.payload.message,
          },
        };
      }

      // Run-level projections — only rebuild byId when the frame type
      // can affect a RunRecord field, so streaming text deltas don't pay
      // the cost of an unnecessary object spread per event.
      const projectsRunRecord =
        frame.type === "sdk.status" ||
        frame.type === "run.final_result" ||
        frame.type === "run.interrupted";
      let nextById = state.byId;
      if (projectsRunRecord) {
        nextById = { ...state.byId };
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
          // Project a terminal status so consumers don't have to special-case
          // 'interrupted' in their status filters. If the reason doesn't map
          // to one of the SDK statuses, keep the existing status (which is
          // usually the matching `sdk.status` frame that runs adjacent).
          const projected = statusFromInterruptedReason(frame.event.payload.reason);
          if (projected) run.status = projected;
        }
        nextById[runId] = run;
      }

      didIngest = true;
      return {
        ...state,
        byId: nextById,
        eventsByRunId: { ...state.eventsByRunId, [runId]: nextEvents },
      };
    });
    if (didIngest) {
      clientPerf.observe(
        "client_event_ingest_ms",
        performance.now() - ingestStart,
      );
    }
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
        modelId: summary.modelId,
        lastTurnInputTokens: summary.lastTurnInputTokens,
        lastTurnOutputTokens: summary.lastTurnOutputTokens,
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
