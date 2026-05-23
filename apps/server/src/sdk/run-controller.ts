import type { FastifyBaseLogger } from "fastify";
import { randomUUID } from "node:crypto";
import type {
  RunInterruptedReason,
  SdkRunStatus,
  SettingsSnapshot,
} from "@harness/shared";
import type { RunsRepo } from "../db/repositories/runs.repo.js";
import type { Run, SDKAgent, SdkAdapter } from "./sdk-adapter.js";
import {
  accumulateTurnEndedUsage,
  extractUsage,
  type ParsedTurnEndedUsage,
} from "./usage-extractor.js";
import type { StreamSink } from "./stream-stub.js";

/**
 * Per-run lifecycle owner. Holds the SDK Run handle, the abort controller
 * used for server-side task coordination (NOT passed to `agent.send` per
 * OQ-11), and the teardown function the registry uses to evict the row.
 *
 * Cancellation:
 *   - The SDK exposes `Run.cancel()` (OQ-12). The harness calls it and
 *     records the resulting status in the `runs` table.
 *   - Per OQ-11, `agent.send` does NOT accept AbortSignal in v1.0.13. The
 *     internal AbortController is therefore used only to detach the
 *     consume-stream task — it never reaches the SDK.
 *
 * Stream consumption:
 *   - `start()` kicks off `run.stream()` iteration and reports the first
 *     event by flipping status to `RUNNING`.
 *   - Each yielded event is handed to the caller-supplied `sink`. Phase 06
 *     uses the stub sink (`./stream-stub.ts`); Phase 07 replaces it with
 *     the normalizer.
 *   - On terminal status (FINISHED/ERROR/CANCELLED/EXPIRED), the controller
 *     awaits `run.wait()` to capture the final `RunResult`, applies the
 *     extracted usage to the `runs` row, then unregisters itself.
 */
export interface RunControllerInit {
  runId: string;
  agentId: string;
  modelId: string;
  prompt: string;
  agent: SDKAgent;
  sdk: SdkAdapter;
  runsRepo: RunsRepo;
  pricing: SettingsSnapshot["pricing"];
  sink: StreamSink;
  logger: FastifyBaseLogger;
}

/**
 * Discriminated outcome of a cancel attempt. The four cases mean very
 * different things for the caller (UI vs internal terminate cascade vs
 * Phase 13 cancel route), so the controller surfaces them separately
 * instead of collapsing into a string "unavailable" that hides intent.
 */
export type CancelResult =
  | { outcome: "cancelled" }
  | { outcome: "not_started" } // start() never resolved (no Run handle yet)
  | { outcome: "unsupported"; unsupportedReason: string | undefined } // SDK reports cancel not supported
  | { outcome: "failed"; error: unknown }; // SDK cancel() threw

export class RunController {
  readonly runId: string;
  readonly agentId: string;
  readonly modelId: string;
  readonly startedAt: Date;
  readonly abortController: AbortController;

  private runHandle: Run | null = null;
  private status: SdkRunStatus = "CREATING";
  private accumulatedUsage: ParsedTurnEndedUsage | null = null;
  private finalisePromise: Promise<void> | null = null;

  private readonly init: RunControllerInit;
  private readonly onTerminate: (controller: RunController) => void;

  constructor(
    init: RunControllerInit,
    onTerminate: (controller: RunController) => void,
  ) {
    this.runId = init.runId;
    this.agentId = init.agentId;
    this.modelId = init.modelId;
    this.startedAt = new Date();
    this.abortController = new AbortController();
    this.init = init;
    this.onTerminate = onTerminate;
  }

  /**
   * Launches the SDK send → stream → wait pipeline. Returns once the SDK
   * has accepted the prompt and yielded a `Run` handle — the consume loop
   * runs detached. Callers should NOT await `start()` for completion; the
   * RunController unregisters itself after the run's terminal status.
   */
  async start(): Promise<void> {
    // OQ-11: `agent.send` does NOT accept AbortSignal in v1.0.13. The
    // controller never passes one — see `sdk-adapter.send`.
    const sendOptions = {
      onDelta: (args: { update: unknown }) => this.onDelta(args.update),
      idempotencyKey: this.runId,
    };
    this.runHandle = await this.init.sdk.send(
      this.init.agent,
      this.init.prompt,
      sendOptions,
    );
    this.setStatus("RUNNING");
    // Consume in the background; the controller's onTerminate fires when
    // the stream/wait pipeline resolves.
    this.finalisePromise = this.consumeAndFinalise();
  }

  /**
   * Wait for the run's terminal state to be persisted. Tests use this to
   * synchronise with the background consume loop; production callers do
   * NOT need to await — the controller cleans itself up.
   */
  awaitSettled(): Promise<void> {
    return this.finalisePromise ?? Promise.resolve();
  }

  async cancel(reason: RunInterruptedReason = "user_cancelled"): Promise<CancelResult> {
    if (!this.runHandle) {
      // start() has not resolved yet — there's no Run to cancel. Caller
      // (terminate cascade, Phase 13 cancel route) decides whether to
      // mark the row as interrupted; we don't write anything because
      // we can't tell whether the SDK already started a run.
      return { outcome: "not_started" };
    }
    if (this.runHandle.supports("cancel") === false) {
      const unsupportedReason = this.runHandle.unsupportedReason("cancel");
      this.init.logger.warn(
        { runId: this.runId, reason, unsupportedReason },
        "run.cancel: SDK reports unsupported — persisting cancel_unavailable so the run doesn't linger",
      );
      // Per spec §11 cancellation contract step 9: when no cancellation
      // primitive is available the harness must NOT fake CANCELLED.
      // Write setInterrupted(stream_error, cancel_unavailable) so the
      // run terminates as ERROR rather than lingering in RUNNING forever.
      this.init.runsRepo.setInterrupted(
        this.runId,
        "stream_error",
        "cancel_unavailable",
      );
      const result: CancelResult = { outcome: "unsupported", unsupportedReason };
      return result;
    }
    try {
      await this.runHandle.cancel();
    } catch (err) {
      this.init.logger.error(
        { err, runId: this.runId },
        "run.cancel: SDK cancel() threw",
      );
      // Cancel was attempted but failed — we don't know whether the SDK
      // managed to abort. Don't promote to CANCELLED; leave it to the
      // consume loop and caller decide.
      return { outcome: "failed", error: err };
    }
    // The SDK should emit a CANCELLED status event next; the consume loop
    // picks it up. Belt-and-braces: stamp CANCELLED here too via the
    // dedicated setter — `setInterrupted` would write status='ERROR',
    // which is the wrong terminal state for a successful user cancel.
    this.init.runsRepo.setCancelled(this.runId, reason);
    // Wait for the background consume loop to settle BEFORE returning to
    // the caller. Otherwise the route resolves "cancelled" while the row
    // is still being updated (final-result, usage) by the detached
    // consume task, and an immediately-following GET can see a non-final
    // row. The consume loop is bounded by `run.wait()`'s timeout (see
    // RUN_WAIT_TIMEOUT_MS below) so this can't hang forever.
    await this.awaitSettled();
    return { outcome: "cancelled" };
  }

  private async consumeAndFinalise(): Promise<void> {
    if (!this.runHandle) return;
    const run = this.runHandle;
    try {
      for await (const event of run.stream()) {
        if (this.abortController.signal.aborted) break;
        try {
          await this.init.sink(event);
        } catch (sinkErr) {
          // Sink errors are logged but never abort the SDK stream while
          // the stub sink is in place. TODO(Phase 07): the normalizer
          // must NOT tolerate sink failures silently — persist-before-
          // broadcast requires that a failed persist abort the broadcast
          // (and ideally the consume loop). Tighten this contract when
          // the normalizer replaces the stub.
          this.init.logger.error(
            { err: sinkErr, runId: this.runId },
            "sink threw on SDK event",
          );
        }
        this.observeStatusFromEvent(event);
      }
    } catch (err) {
      this.init.logger.error(
        { err, runId: this.runId },
        "run.stream() iteration threw",
      );
      this.init.runsRepo.setInterrupted(
        this.runId,
        "stream_error",
        err instanceof Error ? err.message : String(err),
      );
      this.onTerminate(this);
      return;
    }

    let finalResult: Awaited<ReturnType<Run["wait"]>> | null = null;
    if (run.supports("wait")) {
      try {
        // Bounded await — if the SDK fails to resolve wait() (e.g. after
        // a cancel-mid-stream where the stream returned but wait() hangs),
        // we fall back to the observed status rather than leaking the
        // consume task forever. 30s is generous for already-terminal runs
        // and tight enough that an integration test catches a regression.
        finalResult = await raceWithTimeout(run.wait(), RUN_WAIT_TIMEOUT_MS);
      } catch (waitErr) {
        this.init.logger.warn(
          { err: waitErr, runId: this.runId },
          "run.wait() failed after stream completion; preserving observed status",
        );
      }
    }

    // Extract usage regardless of whether we got a final result; the
    // extractor falls back to `unavailable` when the SDK never delivered a
    // turn-ended event.
    const usage = extractUsage({
      rawUsage: this.accumulatedUsage,
      modelId: this.modelId,
      pricing: this.init.pricing,
    });

    if (finalResult) {
      const upper = finalResult.status.toUpperCase() as SdkRunStatus;
      // Single transactional finalize: status + final-result columns +
      // usage all in one UPDATE. The status guard inside `finalize` keeps
      // a CANCELLED/EXPIRED row from being clobbered by a late wait().
      this.init.runsRepo.finalize(this.runId, {
        status: upper,
        finalText: finalResult.result ?? null,
        finalResult,
        gitMetadata: finalResult.git ?? null,
        durationMs: finalResult.durationMs ?? null,
        usage,
      });
      // Mirror the row status into the controller's view so subsequent
      // status frames don't fight the terminal-state guard.
      this.status = upper;
    } else {
      // No final result available — if the consume loop never observed a
      // terminal status, treat the run as interrupted because we can't
      // confirm completion. See spec §11 "run.wait() fails after stream".
      if (!isTerminalStatus(this.status)) {
        this.init.runsRepo.setInterrupted(this.runId, "stream_error", null);
      }
      // Usage still gets persisted; setUsage's guard exempts EXPIRED only.
      this.init.runsRepo.setUsage(this.runId, usage);
    }

    this.onTerminate(this);
  }

  private observeStatusFromEvent(event: unknown): void {
    if (event === null || typeof event !== "object") return;
    const rec = event as Record<string, unknown>;
    if (rec.type !== "status") return;
    const next = rec.status;
    if (typeof next !== "string") return;
    const upper = next.toUpperCase();
    if (
      upper === "CREATING" ||
      upper === "RUNNING" ||
      upper === "FINISHED" ||
      upper === "ERROR" ||
      upper === "CANCELLED" ||
      upper === "EXPIRED"
    ) {
      this.setStatus(upper as SdkRunStatus);
      return;
    }
    // Unknown status literal — log at debug so Phase 14 observability can
    // surface SDK drift (new status values shipped by future SDK
    // releases) without polluting normal-flow logs.
    this.init.logger.debug(
      { runId: this.runId, status: next },
      "sdk.status: unknown status literal — ignoring",
    );
  }

  private onDeltaParseFailureLogged = false;

  private onDelta(update: unknown): void {
    if (update === null || typeof update !== "object") return;
    const rec = update as Record<string, unknown>;
    if (rec.type === "turn-ended") {
      const next = accumulateTurnEndedUsage(
        this.accumulatedUsage,
        (rec as { usage?: unknown }).usage,
      );
      if (next === this.accumulatedUsage && this.accumulatedUsage !== null) {
        // accumulator returned the previous snapshot unchanged → the new
        // payload failed Zod parse. Log once per run to surface SDK shape
        // drift without flooding logs on every turn.
        if (!this.onDeltaParseFailureLogged) {
          this.onDeltaParseFailureLogged = true;
          this.init.logger.warn(
            { runId: this.runId },
            "onDelta: turn-ended payload failed to parse — usage from this turn dropped",
          );
        }
      }
      this.accumulatedUsage = next;
    }
  }

  private setStatus(next: SdkRunStatus): void {
    if (this.status === next) return;
    // Don't overwrite a terminal status (FINISHED / ERROR / CANCELLED /
    // EXPIRED) with a non-terminal one — the SDK can fire a stale status
    // frame for a previously-terminal run during teardown, and the harness
    // must NOT regress a finalised run to RUNNING.
    if (isTerminalStatus(this.status) && !isTerminalStatus(next)) return;
    this.status = next;
    this.init.runsRepo.updateStatus(this.runId, next);
  }
}

function isTerminalStatus(status: SdkRunStatus): boolean {
  return (
    status === "FINISHED" ||
    status === "ERROR" ||
    status === "CANCELLED" ||
    status === "EXPIRED"
  );
}

export function newRunId(): string {
  return randomUUID();
}

const RUN_WAIT_TIMEOUT_MS = 30_000;

class RunWaitTimeoutError extends Error {
  constructor() {
    super(`run.wait() did not resolve within ${RUN_WAIT_TIMEOUT_MS}ms`);
    this.name = "RunWaitTimeoutError";
  }
}

function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RunWaitTimeoutError()), ms);
    if (typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
