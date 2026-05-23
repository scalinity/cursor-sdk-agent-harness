/**
 * Phase 13 — ApprovalResponder seam.
 *
 * OQ-10 is `unverified` against `@cursor/sdk@1.0.13` (no public `respond`/
 * `approve`/`deny` method on `Run`, `SDKAgent`, or the static `Agent`
 * class — see `docs/SDK_VERIFICATION_LEDGER.md`). The harness ships an
 * unimplemented responder that throws `UnimplementedApprovalError`; the
 * WS plugin catches it, persists an `approval.failed` canonical event
 * with code `APPROVAL_UNIMPLEMENTED`, and the UI surfaces a banner so
 * the user is never lied to about resolution.
 *
 * When a future SDK release exposes a resolution method, replace the
 * `throw` below with a runtime probe + call. The interface stays the
 * same; the only thing that changes is the body of `resolve`.
 */
import type { FastifyBaseLogger } from "fastify";
import type { ActiveRuns } from "./active-runs.js";

export class UnimplementedApprovalError extends Error {
  readonly code = "APPROVAL_UNIMPLEMENTED" as const;
  constructor(message = "Cursor SDK does not expose an approval resolver in this version (OQ-10).") {
    super(message);
    this.name = "UnimplementedApprovalError";
  }
}

export interface ApprovalResolveInput {
  runId: string;
  requestId: string;
  decision: "approve" | "deny";
  reason?: string | undefined;
}

export interface ApprovalResponder {
  resolve(input: ApprovalResolveInput): Promise<void>;
}

export interface ApprovalResponderDeps {
  activeRuns: ActiveRuns;
  logger: FastifyBaseLogger;
}

/**
 * Build the production responder. Decision tree (per ledger OQ-10):
 *  1. Look up the active run handle. If the run has gone away, throw
 *     `UnimplementedApprovalError("run not active")` — the WS plugin
 *     catches and converts to `NO_PENDING_REQUEST`.
 *  2. Probe the Run handle for a plausible resolver method
 *     (`respond`, `approve`/`deny`, `respondToRequest`). None exist
 *     in 1.0.13.
 *  3. Throw `UnimplementedApprovalError` — the caller emits
 *     `approval.failed` with `code = "APPROVAL_UNIMPLEMENTED"`.
 *
 * The probe lives in code (not as a comment-only stub) so a future SDK
 * version that exposes one of the candidate methods light up the path
 * automatically — the harness re-validates OQ-10 every time without a
 * config flip.
 */
type ProbeMethod = "respond" | "approve" | "respondToRequest" | "resolveRequest";
const PROBE_METHODS: ReadonlyArray<ProbeMethod> = [
  "respond",
  "approve",
  "respondToRequest",
  "resolveRequest",
];

export function buildApprovalResponder(deps: ApprovalResponderDeps): ApprovalResponder {
  return {
    async resolve(input): Promise<void> {
      const controller = deps.activeRuns.get(input.runId);
      if (!controller) {
        // Run is no longer active. The WS plugin already short-circuits
        // when there is no pending `request` row, but we still want a
        // clear signal here so a future caller (REST? CLI?) doesn't
        // silently no-op.
        throw new UnimplementedApprovalError(
          `Run ${input.runId} has no active controller; cannot route approval`,
        );
      }
      // Pull the Run handle off the controller. The controller exposes
      // it via a read-only accessor we add for this exact purpose; if
      // start() hasn't resolved yet we have no Run to call into.
      const run = controller.getRunHandle();
      if (run === null) {
        throw new UnimplementedApprovalError(
          "Run handle not yet available (start() has not resolved).",
        );
      }
      for (const name of PROBE_METHODS) {
        const candidate = (run as unknown as Record<string, unknown>)[name];
        if (typeof candidate === "function") {
          // Probe success — call with a plausible argument shape. We
          // don't know the SDK's signature; cover the two most common
          // shapes a future SDK release might use.
          deps.logger.warn(
            { method: name, runId: input.runId, requestId: input.requestId },
            "approval-responder: probe hit an unverified method on Run; calling it speculatively",
          );
          try {
            const fn = candidate.bind(run) as (
              ...args: unknown[]
            ) => unknown;
            const result = await Promise.resolve(
              fn(input.requestId, input.decision, { reason: input.reason }),
            );
            void result;
            return;
          } catch (err) {
            deps.logger.warn(
              { err, method: name, runId: input.runId },
              "approval-responder: probed method threw — treating as unimplemented",
            );
            // fall through to the unimplemented throw below
          }
        }
      }
      throw new UnimplementedApprovalError();
    },
  };
}
