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
      // RV2-W2: detect-only. We do NOT speculatively invoke probed
      // methods. The SDK's argument signature is unknown — calling
      // `respond("req-1", "deny", { reason: "x" })` against a future
      // method whose signature is `respond(opts)` would silently
      // pass `"req-1"` as the entire options bag and could approve a
      // deny (or worse). Spec rule "never fake resolution" is better
      // served by an explicit throw than a speculative call. When
      // OQ-10 resolves positively, pin the verified signature in the
      // ledger and call the method here behind a feature flag.
      for (const name of PROBE_METHODS) {
        const candidate = (run as unknown as Record<string, unknown>)[name];
        if (typeof candidate === "function") {
          deps.logger.error(
            { method: name, runId: input.runId, requestId: input.requestId },
            "approval-responder: probe found candidate method but the SDK signature is unverified — refusing to invoke speculatively (OQ-10)",
          );
          throw new UnimplementedApprovalError(
            `Probe found candidate method '${name}' on Run, but its signature is unverified. Refusing to call speculatively until OQ-10 is resolved positively.`,
          );
        }
      }
      throw new UnimplementedApprovalError();
    },
  };
}
