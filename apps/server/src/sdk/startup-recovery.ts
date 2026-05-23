/**
 * Phase 13 — startup recovery for in-flight runs the previous process
 * crashed mid-stream.
 *
 * Spec §11 "Mid-run Server Crash Recovery": every `runs.status` row in
 * `CREATING` or `RUNNING` at process start represents a run whose
 * consume loop never reached a terminal state. The harness must:
 *
 *  1. Append a canonical `run.interrupted` event with
 *     `reason = "server_restart"` (so replay reconstructs the
 *     truncated timeline correctly).
 *  2. Flip the row to `ERROR` with `interrupted_reason = "server_restart"`.
 *
 * Runs that were already `CANCELLED`, `ERROR`, `EXPIRED`, or `FINISHED`
 * are left untouched.
 *
 * This runs in `buildApp.onReady` BEFORE the server accepts connections
 * so a client that re-subscribes to such a run immediately receives the
 * synthetic `run.interrupted` event during replay.
 *
 * IMPORTANT: the recovery flow only appends; it never deletes or
 * rewrites prior events. Replay must remain reproducible.
 *
 * Future ledger note (OQ-14): `Agent.getRun(runId, options)` could
 * reattach a still-alive cloud Run rather than mark it interrupted —
 * Phase 14 will layer reattach atop this fallback. For now, every
 * non-terminal run is marked interrupted because we don't know what
 * the SDK kept alive across process death.
 */
import type { FastifyBaseLogger } from "fastify";
import type { EventsRepo } from "../db/repositories/events.repo.js";
import type { RunsRepo } from "../db/repositories/runs.repo.js";

export interface StartupRecoveryDeps {
  runs: RunsRepo;
  events: EventsRepo;
  logger: FastifyBaseLogger;
}

export interface StartupRecoveryResult {
  recoveredRunIds: string[];
}

export function runStartupRecovery(
  deps: StartupRecoveryDeps,
): StartupRecoveryResult {
  const all = deps.runs.list({ limit: 10_000 });
  const nonTerminal = all.filter(
    (row) => row.status === "CREATING" || row.status === "RUNNING",
  );
  const recoveredRunIds: string[] = [];
  for (const row of nonTerminal) {
    const occurredAt = new Date().toISOString();
    try {
      // Append the synthetic event FIRST so a concurrent reader that
      // already saw `status='RUNNING'` doesn't get a status flip without
      // an accompanying event row to explain it. EventsRepo allocates
      // the next seq inside its own transaction.
      deps.events.appendCanonicalEvent({
        runId: row.id,
        agentId: row.agentId,
        sdkType: "status",
        kind: "run.interrupted",
        callId: null,
        requestId: null,
        status: null,
        payload: {
          reason: "server_restart" as const,
          message: "Server restarted while this run was in flight.",
        },
        raw: null,
        occurredAt,
        receivedAt: occurredAt,
      });
      deps.runs.setInterrupted(row.id, "server_restart", null);
      recoveredRunIds.push(row.id);
    } catch (err) {
      deps.logger.error(
        { err, runId: row.id },
        "startup-recovery: failed to finalize a non-terminal run",
      );
    }
  }
  if (recoveredRunIds.length > 0) {
    deps.logger.info(
      { count: recoveredRunIds.length, runIds: recoveredRunIds },
      "startup-recovery: finalized non-terminal runs from a prior process",
    );
  }
  return { recoveredRunIds };
}
