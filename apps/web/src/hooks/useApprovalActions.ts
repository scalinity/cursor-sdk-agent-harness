/**
 * useApprovalActions — Phase 13 client-side approval sender.
 *
 * Subscribes to `run-store.eventsByRunId[runId].approvalsByRequestId`
 * for the current state of every approval prompt and exposes a
 * `resolve` callback that sends an `approval_response` WS frame. The
 * server responds with `approval.resolved` or `approval.failed`,
 * which lands back through the store via `ingestServerFrame` — the
 * inline `ApprovalPrompt` observes the transition through the same
 * selector.
 *
 * RV2-W1 + S2 + S8: the previous version maintained a local
 * `awaiting_server` overlay with a 10-second setTimeout to clear stale
 * entries. The timer was never cleared on unmount and a stash of dead
 * CSRF reads added confusion. The overlay is gone now: the store
 * status (`pending` until the outcome arrives) is the single source
 * of truth, and the local RTT is short enough that "Awaiting your
 * response" reads correctly as soon as the user clicks. If the user
 * needs a per-click feedback nuance later, build it from the store
 * status alone — never a leakable timer.
 */
import { useCallback } from "react";
import type { ClientFrame } from "@harness/shared";
import { useRunStore, type ApprovalState } from "../state/run-store.js";

export interface UseApprovalActionsResult {
  approvals: ApprovalState[];
  resolve: (
    requestId: string,
    decision: "approve" | "deny",
    reason?: string,
  ) => void;
}

function makeFrameId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function useApprovalActions(
  runId: string | null,
  send: (frame: ClientFrame) => void,
): UseApprovalActionsResult {
  const approvalsMap = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.approvalsByRequestId ?? null) : null,
  );

  const approvals: ApprovalState[] = approvalsMap
    ? Object.values(approvalsMap)
    : [];

  const resolve = useCallback(
    (requestId: string, decision: "approve" | "deny", reason?: string) => {
      if (!runId) return;
      const frame: ClientFrame = {
        id: makeFrameId("approval"),
        type: "approval_response",
        sent_at: new Date().toISOString(),
        run_id: runId,
        request_id: requestId,
        decision,
        ...(reason !== undefined ? { reason } : {}),
      };
      send(frame);
    },
    [runId, send],
  );

  return { approvals, resolve };
}
