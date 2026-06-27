import type { FastifyBaseLogger } from "fastify";
import {
  SDK_RUN_TERMINAL_STATUSES,
  type RunInterruptedReason,
  type SdkRunStatus,
} from "@harness/shared";
import type { RunsRepo } from "../db/repositories/runs.repo.js";
import type { PersistAndBroadcastPipeline } from "./persist-and-broadcast.js";
import type { Run } from "./sdk-adapter.js";
import type { ExtractedUsage } from "./usage-extractor.js";

type FinalResult = Awaited<ReturnType<Run["wait"]>>;

export interface RunFinalizerInit {
  runId: string;
  agentId: string;
  runsRepo: RunsRepo;
  pipeline: Pick<PersistAndBroadcastPipeline, "appendCanonicalEvent">;
  logger: FastifyBaseLogger;
}

/** Last-turn token occupancy persisted alongside the terminal usage. */
export interface ContextOccupancy {
  lastTurnInputTokens: number | null;
  lastTurnOutputTokens: number | null;
}

/**
 * Owns the once-only terminal choreography for a single run: the `runs`-row
 * status mutation paired with its matching terminal canonical event
 * (`run.final_result` / `run.interrupted`).
 *
 * The idempotency guard for the terminal EVENT lives here rather than on the
 * RunController, because two independent paths finalize a run — the explicit
 * `cancel()` path and the background consume/wait loop — and exactly one
 * terminal event must be emitted. The runs-row status mutations are themselves
 * guarded inside `RunsRepo` (a terminal row is never regressed), so this module
 * coordinates the pairing without re-implementing that guard.
 */
export class RunFinalizer {
  private terminalEventAppended = false;

  constructor(private readonly init: RunFinalizerInit) {}

  /**
   * Finalize from the SDK's `RunResult`: one transactional row finalize plus
   * the matching terminal event. Returns the resolved terminal status so the
   * controller can mirror it into its own view.
   */
  finalizeWithResult(
    finalResult: FinalResult,
    usage: ExtractedUsage,
    context: ContextOccupancy,
  ): SdkRunStatus {
    const upper = finalResult.status.toUpperCase() as SdkRunStatus;
    // Single transactional finalize: status + final-result columns + usage +
    // context occupancy in one UPDATE. The status guard inside `finalize`
    // keeps a CANCELLED/EXPIRED row from being clobbered.
    this.init.runsRepo.finalize(this.init.runId, {
      status: upper,
      finalText: finalResult.result ?? null,
      finalResult,
      gitMetadata: finalResult.git ?? null,
      durationMs: finalResult.durationMs ?? null,
      usage,
      lastTurnInputTokens: context.lastTurnInputTokens,
      lastTurnOutputTokens: context.lastTurnOutputTokens,
    });
    if (upper === "FINISHED") {
      this.appendFinalResult(finalResult, usage);
    } else if (upper === "CANCELLED") {
      this.appendInterrupted("user_cancelled");
    } else if (upper === "ERROR" || upper === "EXPIRED") {
      this.appendInterrupted("stream_error");
    }
    return upper;
  }

  /**
   * No `RunResult` was available. If the consume loop never observed a
   * terminal status, treat the run as interrupted because completion can't be
   * confirmed (spec §11 "run.wait() fails after stream"). Usage + occupancy
   * are persisted regardless.
   */
  finalizeWithoutResult(
    currentStatus: SdkRunStatus,
    usage: ExtractedUsage,
    context: ContextOccupancy,
  ): void {
    if (!SDK_RUN_TERMINAL_STATUSES.has(currentStatus)) {
      this.init.runsRepo.setInterrupted(this.init.runId, "stream_error", null);
      this.appendInterrupted("stream_error");
    }
    this.init.runsRepo.setUsage(this.init.runId, usage, {
      lastTurnInputTokens: context.lastTurnInputTokens,
      lastTurnOutputTokens: context.lastTurnOutputTokens,
    });
  }

  /** The consume/finalize pipeline threw — interrupt with the error message. */
  finalizeConsumeError(message: string): void {
    this.init.runsRepo.setInterrupted(this.init.runId, "stream_error", message);
    this.appendInterrupted("stream_error", message);
  }

  /**
   * A successful user/agent cancel: stamp CANCELLED (not ERROR) and emit the
   * interrupted event. Called from the cancel path before the consume loop
   * settles; the shared guard makes the loop's later append a no-op.
   */
  finalizeCancelled(reason: RunInterruptedReason): void {
    this.init.runsRepo.setCancelled(this.init.runId, reason);
    this.appendInterrupted(reason);
  }

  private appendFinalResult(finalResult: FinalResult, usage: ExtractedUsage): void {
    if (this.terminalEventAppended) return;
    const model = (finalResult as { model?: unknown }).model;
    this.init.pipeline.appendCanonicalEvent({
      runId: this.init.runId,
      agentId: this.init.agentId,
      sdkType: "status",
      kind: "run.final_result",
      status: "FINISHED",
      payload: {
        ...(finalResult.result !== undefined && finalResult.result !== null
          ? { text: finalResult.result }
          : {}),
        ...(model !== undefined ? { model } : {}),
        ...(finalResult.durationMs !== undefined ? { duration_ms: finalResult.durationMs } : {}),
        ...(finalResult.git !== undefined && finalResult.git !== null
          ? { git_metadata: finalResult.git }
          : {}),
        usage,
      },
    });
    this.terminalEventAppended = true;
  }

  private appendInterrupted(reason: RunInterruptedReason, message?: string | null): void {
    if (this.terminalEventAppended) return;
    try {
      this.init.pipeline.appendCanonicalEvent({
        runId: this.init.runId,
        agentId: this.init.agentId,
        sdkType: "status",
        kind: "run.interrupted",
        status: reason === "user_cancelled" || reason === "agent_terminated" ? "CANCELLED" : "ERROR",
        payload: {
          reason,
          ...(message ? { message } : {}),
        },
      });
      this.terminalEventAppended = true;
    } catch (err) {
      this.init.logger.error(
        { err, runId: this.init.runId, reason },
        "failed to append run.interrupted canonical event",
      );
    }
  }
}
