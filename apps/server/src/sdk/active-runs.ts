import type { RunController } from "./run-controller.js";

/**
 * In-memory registry of active `RunController` instances. Keyed by `runId`.
 * The `AgentRuntime.terminate(agentId)` flow uses `forAgent()` to abort
 * every active run owned by a terminated agent. The registry is purely
 * runtime state — durable run rows live in `runs` and survive process
 * restart (which then resurrects them via spec §11 Mid-run Server Crash
 * Recovery, landing in Phase 14).
 */
export class ActiveRuns {
  private readonly byRunId = new Map<string, RunController>();

  register(controller: RunController): void {
    this.byRunId.set(controller.runId, controller);
  }

  unregister(runId: string): void {
    this.byRunId.delete(runId);
  }

  get(runId: string): RunController | null {
    return this.byRunId.get(runId) ?? null;
  }

  forAgent(agentId: string): RunController[] {
    const out: RunController[] = [];
    for (const c of this.byRunId.values()) {
      if (c.agentId === agentId) out.push(c);
    }
    return out;
  }

  /**
   * Snapshot of all currently-registered controllers. Used by
   * `AgentRuntime.shutdown` to abort every in-flight consume loop
   * before clearing the registry. Returned as a new array so callers
   * can iterate safely while the underlying map mutates (e.g. an
   * abort that triggers an onTerminate callback).
   */
  all(): RunController[] {
    return Array.from(this.byRunId.values());
  }

  size(): number {
    return this.byRunId.size;
  }

  clear(): void {
    this.byRunId.clear();
  }
}
