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

export type CancelResult = "cancelled" | "unavailable";

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
      return "unavailable";
    }
    if (this.runHandle.supports("cancel") === false) {
      this.init.logger.warn(
        {
          runId: this.runId,
          reason,
          unsupportedReason: this.runHandle.unsupportedReason("cancel"),
        },
        "run.cancel: SDK reports unsupported, returning CANCEL_UNAVAILABLE",
      );
      return "unavailable";
    }
    try {
      await this.runHandle.cancel();
    } catch (err) {
      this.init.logger.error(
        { err, runId: this.runId },
        "run.cancel: SDK cancel() threw",
      );
      // Treat a thrown cancel as "available but failed" — caller decides
      // whether to mark the run ERROR. We do NOT promote to CANCELLED here.
      return "unavailable";
    }
    // The SDK should emit a CANCELLED status event next; the consume loop
    // picks it up. Belt-and-braces: stamp CANCELLED here too via the
    // dedicated setter — `setInterrupted` would write status='ERROR',
    // which is the wrong terminal state for a successful user cancel.
    this.init.runsRepo.setCancelled(this.runId, reason);
    return "cancelled";
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
          // Sink errors are logged but never abort the SDK stream — the
          // normalizer that lands in Phase 07 has its own retry semantics.
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
        finalResult = await run.wait();
      } catch (waitErr) {
        this.init.logger.warn(
          { err: waitErr, runId: this.runId },
          "run.wait() failed after stream completion; preserving observed status",
        );
      }
    }

    if (finalResult) {
      const upper = finalResult.status.toUpperCase() as SdkRunStatus;
      this.setStatus(upper);
      this.init.runsRepo.setFinalResult(this.runId, {
        finalText: finalResult.result ?? null,
        finalResult,
        gitMetadata: finalResult.git ?? null,
        durationMs: finalResult.durationMs ?? null,
      });
    } else {
      // No final result available — if the consume loop never observed a
      // terminal status, treat the run as interrupted because we can't
      // confirm completion. See spec §11 "run.wait() fails after stream".
      if (!isTerminalStatus(this.status)) {
        this.init.runsRepo.setInterrupted(this.runId, "stream_error", null);
      }
    }

    // Apply usage to the row whether we got a final result or not. The
    // extractor is responsible for falling back to `unavailable` when the
    // SDK never delivered a turn-ended event.
    const usage = extractUsage({
      rawUsage: this.accumulatedUsage,
      modelId: this.modelId,
      pricing: this.init.pricing,
    });
    this.init.runsRepo.setUsage(this.runId, usage);

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
    }
  }

  private onDelta(update: unknown): void {
    if (update === null || typeof update !== "object") return;
    const rec = update as Record<string, unknown>;
    if (rec.type === "turn-ended") {
      this.accumulatedUsage = accumulateTurnEndedUsage(
        this.accumulatedUsage,
        (rec as { usage?: unknown }).usage,
      );
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
