import type { RunInterruptedReason } from "@harness/shared";
import type { Run } from "./sdk-adapter.js";
import type { CancelResult } from "./run-controller.js";

/**
 * P23-C4: the common shape the registry needs from any in-flight run, so both
 * the Cursor `RunController` and the non-Cursor `ProviderRunController` can be
 * registered, cancelled (WS cancel + agent terminate), and aborted on
 * shutdown. `getRunHandle` is Cursor-only (the approval probe) and absent on
 * provider runs.
 */
export interface CancelableRun {
  readonly runId: string;
  readonly agentId: string;
  readonly abortController: AbortController;
  cancel(reason?: RunInterruptedReason): Promise<CancelResult>;
  /** Wait for the consume/finalize loop to finish (bounded by shutdown grace). */
  awaitSettled(): Promise<void>;
  getRunHandle?(): Run | null;
}

/**
 * In-memory registry of active runs. Keyed by `runId`.
 * The `AgentRuntime.terminate(agentId)` flow uses `forAgent()` to abort
 * every active run owned by a terminated agent. The registry is purely
 * runtime state — durable run rows live in `runs` and survive process
 * restart (which then resurrects them via spec §11 Mid-run Server Crash
 * Recovery, landing in Phase 14).
 */
export class ActiveRuns {
  private readonly byRunId = new Map<string, CancelableRun>();

  register(controller: CancelableRun): void {
    this.byRunId.set(controller.runId, controller);
  }

  unregister(runId: string): void {
    this.byRunId.delete(runId);
  }

  get(runId: string): CancelableRun | null {
    return this.byRunId.get(runId) ?? null;
  }

  forAgent(agentId: string): CancelableRun[] {
    return this.all().filter((c) => c.agentId === agentId);
  }

  /**
   * Snapshot of all currently-registered controllers. Used by
   * `AgentRuntime.shutdown` to abort every in-flight consume loop
   * before clearing the registry. Returned as a new array so callers
   * can iterate safely while the underlying map mutates (e.g. an
   * abort that triggers an onTerminate callback).
   */
  all(): CancelableRun[] {
    return Array.from(this.byRunId.values());
  }

  size(): number {
    return this.byRunId.size;
  }

  clear(): void {
    this.byRunId.clear();
  }
}
