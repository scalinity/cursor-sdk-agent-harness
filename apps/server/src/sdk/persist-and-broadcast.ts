import type { FastifyBaseLogger } from "fastify";
import type { AgentMode, EventRow, SDKMessage, SdkRunStatus } from "@harness/shared";
import { sdkMessageSchema, subagentLifecyclePayloadSchema } from "@harness/shared";
import type { EventsRepo } from "../db/repositories/events.repo.js";
import type { RunsRepo } from "../db/repositories/runs.repo.js";
import {
  NOOP_PERF_COUNTERS,
  type PerfCounters,
} from "../observability/perf-counters.js";
import type { RunBus } from "../ws/run-bus.js";
import { normalize, type RunContext } from "./normalizer.js";
import type { StreamSink } from "./stream-stub.js";

/**
 * Phase 07 — single persist-then-broadcast pipeline. Replaces the Phase 06
 * stub sink. Every SDK message handed to `ingestSDKMessage` lands in the
 * `events` table BEFORE any WS frame goes out; the bus emit happens only
 * after the DB commit succeeds.
 *
 * The pipeline owns a per-run in-memory text accumulator used by the
 * normalizer to detect delta vs snapshot semantics. The accumulator is
 * keyed by `runId`; callers drop a run from the accumulator when the run
 * terminates (or simply let the process restart drop it — accumulators are
 * pure runtime state and don't need durable persistence).
 */
export interface PipelineDeps {
  events: EventsRepo;
  /** Phase 24: optional in tests, required in production for child sub-agent rows. */
  runs?: RunsRepo;
  bus: RunBus;
  logger: FastifyBaseLogger;
  /**
   * Phase 14 perf counters. Optional so existing callers don't have to
   * thread the recorder through every test fixture; defaults to the
   * no-op recorder.
   */
  perfCounters?: PerfCounters;
}

export interface IngestArgs {
  raw: SDKMessage;
  runId: string;
  agentId: string;
  /**
   * Execution mode of the agent that produced the event. Forwarded into
   * RunContext so the normalizer can stamp the correct mode on
   * `system.init` (the SDK doesn't expose it on the wire).
   */
  agentMode: AgentMode;
  receivedAt?: string;
  /** Override the occurred_at timestamp; defaults to `receivedAt`. */
  occurredAt?: string;
}

interface RunBufferState {
  assistantText: string;
  thinkingText: string;
}

export interface PersistAndBroadcastPipeline {
  ingestSDKMessage(args: IngestArgs): void;
  /**
   * Record an SDK event that failed `sdkMessageSchema` validation. We
   * persist a synthetic canonical event with `kind =
   * "system.unknown_sdk_message"` and the offending shape in
   * `raw_json` so an inspector can diagnose SDK shape drift after the
   * fact. The frame-builder returns null for this kind so it is NOT
   * broadcast over WS — replay UIs are protected from unknown shapes
   * while the durable record survives for forensics.
   */
  ingestUnknownSDKMessage(args: {
    raw: unknown;
    runId: string;
    agentId: string;
    parseError: unknown;
    receivedAt?: string;
    occurredAt?: string;
  }): void;
  /** Discard the in-memory text buffer for a run that's about to terminate. */
  dropRun(runId: string): void;
  /** Test/teardown hook: clear ALL per-run buffers. */
  clear(): void;
  /** Test inspection hook: current count of buffered runs. */
  bufferCount(): number;
  /**
   * Phase 13 — append a synthetic canonical event whose origin is NOT
   * an SDK message (e.g. `approval.resolved` / `approval.failed` from
   * the WS plugin). The caller owns the `(sdkType, kind, payload)`
   * tuple; the pipeline allocates the seq inside the same transaction
   * as the row insert and publishes to the bus only after commit.
   *
   * The kind is widened to `string` because the harness emits a few
   * non-canonical kinds (e.g. forensic `system.unknown_sdk_message`);
   * frame-builder gates broadcast on the closed `CanonicalEventKind`
   * union.
   */
  appendCanonicalEvent(args: {
    runId: string;
    agentId: string;
    sdkType: "request" | "status" | "system";
    kind: string;
    callId?: string | null;
    requestId?: string | null;
    status?: string | null;
    payload: unknown;
    occurredAt?: string;
  }): void;
}

/**
 * Cap on simultaneously-buffered runs. A single-user local harness
 * realistically has at most a handful of active runs at a time; 512
 * leaves enough headroom for fire-and-forget background runs while
 * bounding memory if an `onTerminate` callback is ever missed (e.g.
 * runtime exception before dropRun fires). Mirrors the LiveAgents LRU
 * pattern.
 */
const DEFAULT_BUFFER_CAPACITY = 512;

export interface PipelineOptions {
  /** Override the LRU cap on `bufferByRun` size. */
  bufferCapacity?: number;
}

export function createPersistAndBroadcast(
  deps: PipelineDeps,
  options: PipelineOptions = {},
): PersistAndBroadcastPipeline {
  const capacity = options.bufferCapacity ?? DEFAULT_BUFFER_CAPACITY;
  const perf = deps.perfCounters ?? NOOP_PERF_COUNTERS;
  // Map preserves insertion order; we promote to most-recently-used on
  // every `getBuffer` so the LRU eviction picks a genuinely stale run.
  const bufferByRun = new Map<string, RunBufferState>();

  function getBuffer(runId: string): RunBufferState {
    const existing = bufferByRun.get(runId);
    if (existing !== undefined) {
      // Promote to MRU: delete + re-insert moves the key to the tail.
      bufferByRun.delete(runId);
      bufferByRun.set(runId, existing);
      return existing;
    }
    if (bufferByRun.size >= capacity) {
      // Evict the oldest entry — first key in insertion order. This is
      // a safety net; production paths always call dropRun on
      // termination. An eviction here means somebody forgot to drop.
      const firstKey = bufferByRun.keys().next().value;
      if (firstKey !== undefined) {
        bufferByRun.delete(firstKey);
        deps.logger.warn(
          { evictedRunId: firstKey, capacity },
          "persist-and-broadcast: LRU-evicted a per-run text buffer (forgot dropRun?)",
        );
      }
    }
    const fresh: RunBufferState = { assistantText: "", thinkingText: "" };
    bufferByRun.set(runId, fresh);
    return fresh;
  }

  return {
    ingestSDKMessage(args): void {
      const receivedAt = args.receivedAt ?? new Date().toISOString();
      const occurredAt = args.occurredAt ?? receivedAt;
      const buffer = getBuffer(args.runId);

      const runContext: RunContext = {
        runId: args.runId,
        agentId: args.agentId,
        agentMode: args.agentMode,
        receivedAt,
        occurredAt,
        previousAssistantText: buffer.assistantText,
        previousThinkingText: buffer.thinkingText,
      };

      const { events: drafts, textBufferUpdates } = normalize({
        raw: args.raw,
        runContext,
      });

      if (drafts.length === 0) {
        // Unknown discriminant or filtered event — log and drop. The
        // normalizer never silently produces zero events for known types.
        deps.logger.debug(
          { runId: args.runId, rawType: (args.raw as { type?: string }).type ?? "<unknown>" },
          "persist-and-broadcast: normalizer produced no events",
        );
        return;
      }

      if (!prepareSubagentLifecycleRows(deps, drafts, args)) {
        return;
      }

      // Persist each draft. EventsRepo.appendCanonicalEvent owns the
      // transaction that allocates the seq AND inserts the row, so each
      // iteration here either fully commits or rolls back. If any draft
      // fails, the caller must treat the stream as failed; otherwise the
      // durable event log would permanently miss an SDK event while the run
      // continues toward a false successful finish.
      const persisted: EventRow[] = [];
      for (const draft of drafts) {
        const commitStart = performance.now();
        try {
          const row = deps.events.appendCanonicalEvent({
            runId: args.runId,
            agentId: args.agentId,
            sdkType: draft.sdkType,
            kind: draft.kind,
            callId: draft.callId,
            requestId: draft.requestId,
            status: draft.status,
            payload: draft.payload,
            raw: draft.raw,
            occurredAt: draft.occurredAt,
            receivedAt: draft.receivedAt,
          }, subagentLifecycleSync(deps, draft, args));
          perf.observe(
            "sdk_event_received_to_db_commit_ms",
            performance.now() - commitStart,
          );
          persisted.push(row);
        } catch (err) {
          deps.logger.error(
            {
              err,
              runId: args.runId,
              agentId: args.agentId,
              kind: draft.kind,
            },
            "persist-and-broadcast: event insert failed; skipping broadcast for this draft batch",
          );
          throw err;
        }
      }

      // Commit succeeded for every draft in the batch — only NOW do we
      // update the text buffer. This keeps the buffer consistent with what
      // the DB actually holds: a failed insert above never advances the
      // delta cursor, so the next event still computes against the
      // pre-failure text.
      if (textBufferUpdates.assistantText !== undefined) {
        buffer.assistantText = textBufferUpdates.assistantText;
      }
      if (textBufferUpdates.thinkingText !== undefined) {
        buffer.thinkingText = textBufferUpdates.thinkingText;
      }

      // Persist-before-broadcast: the publish below is the single point at
      // which a WS frame can leave the server for this event. No other code
      // path may call bus.publish() for canonical events.
      for (const row of persisted) {
        const broadcastStart = performance.now();
        deps.bus.publish(args.runId, row);
        perf.observe(
          "db_commit_to_bus_publish_ms",
          performance.now() - broadcastStart,
        );
      }
    },

    ingestUnknownSDKMessage(args): void {
      const receivedAt = args.receivedAt ?? new Date().toISOString();
      const occurredAt = args.occurredAt ?? receivedAt;
      const sdkType = typeof (args.raw as { type?: unknown })?.type === "string"
        ? ((args.raw as { type: string }).type)
        : "<unknown>";
      try {
        deps.events.appendCanonicalEvent({
          runId: args.runId,
          agentId: args.agentId,
          // Use `system` so the CHECK constraint on events.sdk_type
          // (limited to the spec's eight discriminants) accepts the row.
          // The `kind` carries the real intent and the frame-builder's
          // switch returns null for it, suppressing broadcast.
          sdkType: "system",
          kind: "system.unknown_sdk_message",
          callId: null,
          requestId: null,
          status: null,
          payload: {
            // Be defensive — the offending shape might be anything.
            sdk_type: sdkType,
            parse_error:
              args.parseError instanceof Error
                ? { message: args.parseError.message, name: args.parseError.name }
                : String(args.parseError),
          },
          raw: args.raw,
          occurredAt,
          receivedAt,
        });
      } catch (err) {
        // If even the synthetic record can't land (e.g. JSON.stringify
        // fails on a circular value), log and drop — we never let the
        // forensic capture path crash the consume loop.
        deps.logger.error(
          { err, runId: args.runId, sdkType },
          "persist-and-broadcast: failed to persist unknown SDK shape; dropping forensic record",
        );
      }
    },

    dropRun(runId): void {
      bufferByRun.delete(runId);
    },

    clear(): void {
      bufferByRun.clear();
    },

    bufferCount(): number {
      return bufferByRun.size;
    },

    appendCanonicalEvent(args): void {
      // RV2-C1: persist-before-broadcast is the law. Earlier this caught
      // and logged DB errors silently, which let the WS approval handler
      // ack-ok the client on a failed persist. The caller now sees
      // failures and can convert them to an INTERNAL_ERROR frame.
      const occurredAt = args.occurredAt ?? new Date().toISOString();
      const commitStart = performance.now();
      const row = deps.events.appendCanonicalEvent({
        runId: args.runId,
        agentId: args.agentId,
        sdkType: args.sdkType,
        kind: args.kind,
        callId: args.callId ?? null,
        requestId: args.requestId ?? null,
        status: args.status ?? null,
        payload: args.payload,
        raw: null,
        occurredAt,
        receivedAt: occurredAt,
      });
      perf.observe(
        "sdk_event_received_to_db_commit_ms",
        performance.now() - commitStart,
      );
      const broadcastStart = performance.now();
      deps.bus.publish(args.runId, row);
      perf.observe(
        "db_commit_to_bus_publish_ms",
        performance.now() - broadcastStart,
      );
    },
  };
}

function terminalSubagentStatus(status: SdkRunStatus | undefined): Extract<SdkRunStatus, "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED"> {
  if (status === "ERROR" || status === "CANCELLED" || status === "EXPIRED") return status;
  return "FINISHED";
}

function prepareSubagentLifecycleRows(
  deps: PipelineDeps,
  drafts: Array<{ kind: string; payload: unknown }>,
  args: IngestArgs,
): boolean {
  if (!deps.runs) return true;
  for (const draft of drafts) {
    if (draft.kind !== "subagent.spawned" && draft.kind !== "subagent.completed") continue;
    const parsed = subagentLifecyclePayloadSchema.safeParse(draft.payload);
    if (!parsed.success) {
      deps.logger.error(
        { runId: args.runId, kind: draft.kind, issues: parsed.error.issues },
        "persist-and-broadcast: invalid subagent lifecycle payload; skipping draft batch",
      );
      return false;
    }
    const parent = deps.runs.getById(parsed.data.parent_run_id);
    if (!parent) {
      deps.logger.warn(
        { runId: args.runId, parentRunId: parsed.data.parent_run_id },
        "persist-and-broadcast: subagent parent run not found; skipping draft batch",
      );
      return false;
    }
  }
  return true;
}

function subagentLifecycleSync(
  deps: PipelineDeps,
  draft: { kind: string; payload: unknown },
  args: IngestArgs,
): (() => void) | undefined {
  const runs = deps.runs;
  if (!runs) return undefined;
  if (draft.kind !== "subagent.spawned" && draft.kind !== "subagent.completed") return undefined;
  const parsed = subagentLifecyclePayloadSchema.parse(draft.payload);
  return () => {
    const parent = runs.getById(parsed.parent_run_id);
    if (!parent) {
      throw new Error(`subagent parent run not found id=${parsed.parent_run_id}`);
    }
    runs.ensureSubagentRun({
      id: parsed.child_run_id,
      parentRunId: parent.id,
      agentId: args.agentId,
      name: parsed.subagent_name,
      modelId: parent.modelId,
      mode: parent.mode ?? args.agentMode,
      executionMode: parent.executionMode,
      workspaceId: parent.workspaceId,
    });

    if (draft.kind === "subagent.completed") {
      runs.completeSubagentRun(
        parsed.child_run_id,
        terminalSubagentStatus(parsed.status),
      );
    }
  };
}

/**
 * Build the per-run stream sink that hands every SDK event to a
 * pipeline. Events that fail Zod validation against `sdkMessageSchema`
 * get persisted as `system.unknown_sdk_message` so Phase 14
 * observability can see SDK shape drift — the row carries the
 * offending raw payload and is inspectable, but the frame-builder
 * returns null for that kind so live UIs are protected from unknown
 * shapes.
 *
 * Co-located with the pipeline so the validation boundary lives next
 * to the persistence boundary; AgentRuntime just calls this helper
 * and stays unaware of the schema shape.
 */
export function createPipelineSink(args: {
  runId: string;
  agentId: string;
  agentMode: AgentMode;
  pipeline: PersistAndBroadcastPipeline;
  logger: FastifyBaseLogger;
}): StreamSink {
  return (event: unknown) => {
    const parsed = sdkMessageSchema.safeParse(event);
    if (!parsed.success) {
      args.logger.warn(
        {
          runId: args.runId,
          agentId: args.agentId,
          sdkType: (event as { type?: unknown })?.type,
          errors: parsed.error.flatten(),
        },
        "pipeline-sink: SDK event failed sdkMessageSchema; persisting as system.unknown_sdk_message",
      );
      args.pipeline.ingestUnknownSDKMessage({
        raw: event,
        runId: args.runId,
        agentId: args.agentId,
        parseError: parsed.error,
      });
      return;
    }
    const raw: SDKMessage = parsed.data;
    args.pipeline.ingestSDKMessage({
      raw,
      runId: args.runId,
      agentId: args.agentId,
      agentMode: args.agentMode,
    });
  };
}
