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
 * `eventChunks` keeps canonical events in seq order without copying the
 * whole run on every append. Hot renderers subscribe to the incremental
 * projections below instead of rescanning the full event log per frame.
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
import { deleteRunBuffers } from "../lib/streaming-text-channel.js";
import { parseCodeEditPayload } from "../lib/code-edit-events.js";
import { clientPerf } from "../lib/perf-counters.js";
import {
  groupToolCallLanes,
  upsertToolCallProjection,
  type ToolCallLaneGroup,
  type ToolCallProjection,
} from "../lib/tool-call-projection.js";

const EVENT_CHUNK_SIZE = 256;

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
  byEventId: Map<string, CanonicalRunEvent>;
  /** Fixed-size seq-ordered chunks. Append copies at most one chunk. */
  eventChunks: CanonicalRunEvent[][];
  /** Bumps whenever eventChunks changes; useful for memo keys. */
  eventsVersion: number;
  lastSeq: number;
  lastReceivedAt: string | null;
  /** Concatenated assistant text from delta/snapshot events. */
  assistantText: string;
  /** Concatenated thinking text from delta/snapshot events. */
  thinkingText: string;
  /** Latest thinking_duration_ms from thinking events. */
  thinkingDurationMs: number | null;
  /** Maintained incrementally as `sdk.tool_call` frames arrive. */
  toolCallCount: number;
  /** Incremental projection for ToolCallLane and health checks. */
  toolCallProjections: ToolCallProjection[];
  toolCallGroups: ToolCallLaneGroup[];
  /** Derived code-edit events in seq order. */
  codeEditEvents: CanonicalRunEvent[];
  codeEditEventBySourceCallId: Record<string, CanonicalRunEvent>;
  /** Sub-agent lifecycle events in seq order. */
  subagentLifecycleEvents: CanonicalRunEvent[];
  /** request_id -> nearest running tool call when the approval was requested. */
  approvalToolCallIdByRequestId: Record<string, string>;
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
  /** Drop in-memory run state and streaming-text buffers for an explicit deletion. */
  removeRun: (runId: string) => void;
  resetRun: (runId: string) => void;
  setRunStatus: (runId: string, status: SdkRunStatus | null) => void;
}

function emptyEventState(): RunEventState {
  return {
    seqList: [],
    bySeq: new Map(),
    byEventId: new Map(),
    eventChunks: [],
    eventsVersion: 0,
    lastSeq: 0,
    lastReceivedAt: null,
    assistantText: "",
    thinkingText: "",
    thinkingDurationMs: null,
    toolCallCount: 0,
    toolCallProjections: [],
    toolCallGroups: [],
    codeEditEvents: [],
    codeEditEventBySourceCallId: {},
    subagentLifecycleEvents: [],
    approvalToolCallIdByRequestId: {},
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
export function applyTextEvent(
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
 * Flatten event chunks for non-hot compatibility surfaces. Keep this out of
 * ingest so appending a token never copies the whole run's event history.
 */
export function flattenEventChunks(
  chunks: ReadonlyArray<ReadonlyArray<CanonicalRunEvent>>,
): CanonicalRunEvent[] {
  return chunks.flatMap((chunk) => [...chunk]);
}

function rechunkEvents(events: readonly CanonicalRunEvent[]): CanonicalRunEvent[][] {
  const chunks: CanonicalRunEvent[][] = [];
  for (let i = 0; i < events.length; i += EVENT_CHUNK_SIZE) {
    chunks.push(events.slice(i, i + EVENT_CHUNK_SIZE));
  }
  return chunks;
}

function appendEventChunk(
  chunks: readonly CanonicalRunEvent[][],
  canonical: CanonicalRunEvent,
): CanonicalRunEvent[][] {
  const next = chunks.slice();
  const last = next[next.length - 1];
  if (!last || last.length >= EVENT_CHUNK_SIZE) {
    next.push([canonical]);
  } else {
    next[next.length - 1] = [...last, canonical];
  }
  return next;
}

function insertEventBySeq(
  events: readonly CanonicalRunEvent[],
  canonical: CanonicalRunEvent,
): CanonicalRunEvent[] {
  if (events.length === 0 || events[events.length - 1]!.seq < canonical.seq) {
    return [...events, canonical];
  }
  const next = events.slice();
  let lo = 0;
  let hi = next.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (next[mid]!.seq < canonical.seq) lo = mid + 1;
    else hi = mid;
  }
  next.splice(lo, 0, canonical);
  return next;
}

function latestRunningToolCallId(projections: readonly ToolCallProjection[]): string | null {
  for (let i = projections.length - 1; i >= 0; i -= 1) {
    const projection = projections[i];
    if (projection?.status === "running") return projection.callId;
  }
  return null;
}

function thinkingDurationFromPayload(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value = (payload as { thinking_duration_ms?: unknown }).thinking_duration_ms;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Binary-insert `seq` into the sorted `seqList` and mirror the event into
 * chunked storage. The hot path copies the seq list and at most one chunk;
 * rare out-of-order recovery flattens/rechunks to preserve seq order.
 */
function insertSeqInOrder(
  list: number[],
  chunks: CanonicalRunEvent[][],
  seq: number,
  canonical: CanonicalRunEvent,
): { list: number[]; chunks: CanonicalRunEvent[][] } {
  if (list.length === 0 || list[list.length - 1]! < seq) {
    return { list: [...list, seq], chunks: appendEventChunk(chunks, canonical) };
  }
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid]! < seq) lo = mid + 1;
    else hi = mid;
  }
  const nextList = list.slice();
  nextList.splice(lo, 0, seq);
  const flattened = flattenEventChunks(chunks);
  flattened.splice(lo, 0, canonical);
  return { list: nextList, chunks: rechunkEvents(flattened) };
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

function usageFromRunSummary(summary: RunSummary): TokenUsage | null {
  if (
    summary.inputTokens === null &&
    summary.outputTokens === null &&
    summary.cachedInputTokens === null &&
    summary.reasoningTokens === null &&
    summary.costUsdMicros === null &&
    summary.usageSource === null
  ) {
    return null;
  }
  return {
    input_tokens: summary.inputTokens,
    output_tokens: summary.outputTokens,
    cached_input_tokens: summary.cachedInputTokens,
    reasoning_tokens: summary.reasoningTokens,
    cost_usd_micros: summary.costUsdMicros,
    usage_source: summary.usageSource ?? "unavailable",
  };
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
            byEventId: prevEvents.byEventId,
            eventChunks: prevEvents.eventChunks,
            eventsVersion: prevEvents.eventsVersion,
            lastSeq: prevEvents.lastSeq,
            lastReceivedAt: prevEvents.lastReceivedAt,
            assistantText: prevEvents.assistantText,
            thinkingText: prevEvents.thinkingText,
            thinkingDurationMs: prevEvents.thinkingDurationMs,
            toolCallCount: prevEvents.toolCallCount,
            toolCallProjections: prevEvents.toolCallProjections,
            toolCallGroups: prevEvents.toolCallGroups,
            codeEditEvents: prevEvents.codeEditEvents,
            codeEditEventBySourceCallId: prevEvents.codeEditEventBySourceCallId,
            subagentLifecycleEvents: prevEvents.subagentLifecycleEvents,
            approvalToolCallIdByRequestId: prevEvents.approvalToolCallIdByRequestId,
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
        nextEvents.eventChunks,
        evt.seq,
        canonical,
      );
      nextEvents.seqList = inserted.list;
      nextEvents.eventChunks = inserted.chunks;
      nextEvents.eventsVersion += 1;
      const newBySeq = new Map(nextEvents.bySeq);
      newBySeq.set(evt.seq, canonical);
      nextEvents.bySeq = newBySeq;
      const newByEventId = new Map(nextEvents.byEventId);
      newByEventId.set(evt.event_id, canonical);
      nextEvents.byEventId = newByEventId;
      nextEvents.lastSeq = Math.max(nextEvents.lastSeq, evt.seq);
      nextEvents.lastReceivedAt = evt.received_at;

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
        const duration = thinkingDurationFromPayload(frame.event.payload);
        if (duration !== null) nextEvents.thinkingDurationMs = duration;
      } else if (frame.type === "sdk.tool_call") {
        // Maintain incrementally so renderers don't rescan the seqList.
        nextEvents.toolCallCount += 1;
        nextEvents.toolCallProjections = upsertToolCallProjection(
          nextEvents.toolCallProjections,
          canonical,
        );
        nextEvents.toolCallGroups = groupToolCallLanes(nextEvents.toolCallProjections);
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
        const toolCallId = latestRunningToolCallId(nextEvents.toolCallProjections);
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
        if (toolCallId !== null) {
          nextEvents.approvalToolCallIdByRequestId = {
            ...nextEvents.approvalToolCallIdByRequestId,
            [reqId]: toolCallId,
          };
        }
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

      if (evt.kind === "code_edit.detected") {
        const payload = parseCodeEditPayload(evt.payload);
        nextEvents.codeEditEvents = insertEventBySeq(nextEvents.codeEditEvents, canonical);
        if (payload?.source_call_id) {
          nextEvents.codeEditEventBySourceCallId = {
            ...nextEvents.codeEditEventBySourceCallId,
            [payload.source_call_id]: canonical,
          };
        }
      } else if (evt.kind === "subagent.spawned" || evt.kind === "subagent.completed") {
        nextEvents.subagentLifecycleEvents = insertEventBySeq(
          nextEvents.subagentLifecycleEvents,
          canonical,
        );
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
        usage: usageFromRunSummary(summary),
        usageSource: summary.usageSource,
        modelId: summary.modelId,
        lastTurnInputTokens: summary.lastTurnInputTokens,
        lastTurnOutputTokens: summary.lastTurnOutputTokens,
      };
      return { ...state, byId: { ...state.byId, [summary.id]: updated } };
    });
  },

  setActiveRunId: (runId) => set({ activeRunId: runId }),

  removeRun: (runId) => {
    deleteRunBuffers(runId);
    set((state) => {
      const nextById = { ...state.byId };
      delete nextById[runId];
      const nextEvents = { ...state.eventsByRunId };
      delete nextEvents[runId];
      const activeRunId = state.activeRunId === runId ? null : state.activeRunId;
      return {
        ...state,
        byId: nextById,
        eventsByRunId: nextEvents,
        activeRunId,
      };
    });
  },

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
