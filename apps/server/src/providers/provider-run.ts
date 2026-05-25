import type { FastifyBaseLogger } from "fastify";
import type {
  ModelPricingHint,
  RunInterruptedReason,
  SDKMessage,
  TokenUsage,
} from "@harness/shared";
import type { RunsRepo } from "../db/repositories/runs.repo.js";
import type { PersistAndBroadcastPipeline } from "../sdk/persist-and-broadcast.js";
import type { CancelableRun } from "../sdk/active-runs.js";
import type { CancelResult } from "../sdk/run-controller.js";
import type { ModelProvider, ProviderUsage } from "./provider.js";

/**
 * Phase 23 — drives a non-Cursor (chat-only) provider and emits the SAME
 * canonical events as a Cursor run, so streaming surfaces + replay are
 * identical. It feeds synthetic SDK-shaped messages through the normalizer
 * pipeline (system.init → assistant deltas → status) and finalizes the run
 * row exactly like RunController does — minus tool-call events (providers
 * have no tool-use infrastructure in v1.2).
 */

export interface ProviderRunInit {
  runId: string;
  agentId: string;
  modelName: string;
  prompt: string;
  systemPrompt?: string | undefined;
  provider: ModelProvider;
  pricing?: ModelPricingHint | undefined;
  runsRepo: RunsRepo;
  pipeline: PersistAndBroadcastPipeline;
  logger: FastifyBaseLogger;
}

export class ProviderRunController implements CancelableRun {
  readonly runId: string;
  readonly agentId: string;
  readonly abortController = new AbortController();
  private settled: Promise<void> | null = null;
  private cancelReason: RunInterruptedReason | null = null;

  constructor(
    private readonly init: ProviderRunInit,
    private readonly onTerminate: (runId: string) => void,
  ) {
    this.runId = init.runId;
    this.agentId = init.agentId;
  }

  /** Fire-and-forget, mirroring RunController.start(). */
  start(): void {
    this.settled = this.run().catch((err: unknown) => {
      this.init.logger.error({ err, runId: this.runId }, "provider run failed");
    });
  }

  awaitSettled(): Promise<void> {
    return this.settled ?? Promise.resolve();
  }

  /**
   * P23-C4: cancel the in-flight provider stream and wait for finalization.
   * The abort aborts the provider's fetch/SDK call; `run()` then records the
   * run as CANCELLED (not ERROR — see P23-W1). Returns once the run row is
   * terminal so the caller doesn't observe a still-RUNNING row.
   */
  async cancel(reason: RunInterruptedReason = "user_cancelled"): Promise<CancelResult> {
    this.cancelReason = reason;
    this.abortController.abort();
    await this.awaitSettled();
    return { outcome: "cancelled" };
  }

  private emit(message: SDKMessage): void {
    this.init.pipeline.ingestSDKMessage({
      raw: message,
      runId: this.runId,
      agentId: this.agentId,
      agentMode: "local",
    });
  }

  private async run(): Promise<void> {
    const startedAt = Date.now();
    this.emit({ type: "system", subtype: "init", agent_id: this.agentId, run_id: this.runId });
    this.init.runsRepo.updateStatus(this.runId, "RUNNING");
    this.emit({ type: "status", agent_id: this.agentId, run_id: this.runId, status: "RUNNING" });

    let finalText = "";
    let usage: ProviderUsage | null = null;
    let errored: string | null = null;

    try {
      for await (const ev of this.init.provider.sendMessage(this.init.prompt, {
        model: this.init.modelName,
        systemPrompt: this.init.systemPrompt,
        signal: this.abortController.signal,
      })) {
        if (ev.type === "text_delta") {
          finalText += ev.content;
          this.emit({
            type: "assistant",
            agent_id: this.agentId,
            run_id: this.runId,
            message: { role: "assistant", content: [{ type: "text", text: ev.content }] },
          });
        } else if (ev.type === "thinking_delta") {
          this.emit({
            type: "thinking",
            agent_id: this.agentId,
            run_id: this.runId,
            text: ev.content,
          });
        } else if (ev.type === "usage") {
          usage = ev.usage;
        } else if (ev.type === "error") {
          errored = ev.message;
        }
      }
    } catch (err) {
      errored = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - startedAt;
    const tokenUsage = this.buildUsage(usage);

    if (this.abortController.signal.aborted) {
      // P23-W1: an aborted run is a cancellation, not a stream error — record
      // CANCELLED so history/usage don't mislabel it as a failure.
      this.emit({ type: "status", agent_id: this.agentId, run_id: this.runId, status: "CANCELLED" });
      this.init.runsRepo.setCancelled(this.runId, this.cancelReason ?? "user_cancelled");
      this.init.runsRepo.setUsage(this.runId, tokenUsage);
    } else if (errored) {
      this.emit({ type: "status", agent_id: this.agentId, run_id: this.runId, status: "ERROR" });
      this.init.runsRepo.setInterrupted(this.runId, "stream_error", errored);
      this.init.runsRepo.setUsage(this.runId, tokenUsage);
    } else {
      this.emit({
        type: "status",
        agent_id: this.agentId,
        run_id: this.runId,
        status: "FINISHED",
      });
      this.init.runsRepo.finalize(this.runId, {
        status: "FINISHED",
        finalText: finalText.length > 0 ? finalText : null,
        finalResult: null,
        gitMetadata: null,
        durationMs,
        usage: tokenUsage,
      });
    }
    // onTerminate owns cleanup (unregister from activeRuns + pipeline.dropRun).
    this.onTerminate(this.runId);
  }

  private buildUsage(usage: ProviderUsage | null): TokenUsage {
    if (!usage) {
      return {
        input_tokens: null,
        output_tokens: null,
        cached_input_tokens: null,
        reasoning_tokens: null,
        cost_usd_micros: null,
        usage_source: "unavailable",
      };
    }
    const cost = this.init.pricing
      ? Math.round(
          (usage.inputTokens / 1_000_000) * this.init.pricing.inputPerMillionMicros +
            (usage.outputTokens / 1_000_000) * this.init.pricing.outputPerMillionMicros,
        )
      : null;
    // P23-W8: provider-reported token counts are a verified final-result
    // extraction (not a local estimate), so `sdk_final_result` is the closest
    // honest discriminator. A dedicated `provider_reported` value was
    // considered but rejected: the runs.usage_source CHECK constraint
    // (migration 0001) would require a full SQLite table rebuild — including
    // the runs_fts triggers + indexes — which is disproportionate to a label.
    return {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cached_input_tokens: null,
      reasoning_tokens: null,
      cost_usd_micros: cost,
      usage_source: "sdk_final_result",
    };
  }
}
