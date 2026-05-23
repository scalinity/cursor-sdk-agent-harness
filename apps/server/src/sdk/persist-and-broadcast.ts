import type { FastifyBaseLogger } from "fastify";
import type { AgentMode, EventRow, SDKMessage } from "@harness/shared";
import type { EventsRepo } from "../db/repositories/events.repo.js";
import type { RunBus } from "../ws/run-bus.js";
import { normalize, type RunContext } from "./normalizer.js";

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
  bus: RunBus;
  logger: FastifyBaseLogger;
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
  /** Discard the in-memory text buffer for a run that's about to terminate. */
  dropRun(runId: string): void;
  /** Test/teardown hook: clear ALL per-run buffers. */
  clear(): void;
  /** Test inspection hook: current count of buffered runs. */
  bufferCount(): number;
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

      // Persist each draft. EventsRepo.appendCanonicalEvent owns the
      // transaction that allocates the seq AND inserts the row, so each
      // iteration here either fully commits or rolls back. If any draft
      // fails, subsequent drafts in the same batch are skipped — the
      // broadcast loop only sees committed rows.
      const persisted: EventRow[] = [];
      for (const draft of drafts) {
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
          });
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
          // Stop the batch — we'd otherwise produce a sequence gap on the
          // wire if a mid-batch event landed but an earlier one did not.
          // Caller decides whether to retry (today: no retry; the SDK won't
          // re-emit a missed event).
          return;
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
        deps.bus.publish(args.runId, row);
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
  };
}
