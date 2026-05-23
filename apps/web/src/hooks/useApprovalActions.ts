/**
 * useApprovalActions — Phase 13 client-side approval state machine.
 *
 * Subscribes to `run-store.eventsByRunId[runId].approvalsByRequestId` for
 * the current state of every approval prompt and exposes a `resolve`
 * callback that sends an `approval_response` WS frame. The server
 * responds with `approval.resolved` or `approval.failed`, which lands
 * back through the store via `ingestServerFrame` — components observe
 * the state transition through the same selector.
 *
 * Notes:
 *   - The hook does NOT mutate `approvalsByRequestId` itself. The store
 *     is the single source of truth; the hook is a sender only.
 *   - "awaiting_server" is purely local — the store still reads
 *     "pending" until the outcome arrives.
 */
import { useCallback, useState } from "react";
import type { ClientFrame } from "@harness/shared";
import { useRunStore, type ApprovalState } from "../state/run-store.js";
import { useUiStore } from "../state/ui-store.js";

export type ApprovalUiStatus = ApprovalState["status"] | "awaiting_server";

export interface ApprovalUiState extends Omit<ApprovalState, "status"> {
  status: ApprovalUiStatus;
}

export interface UseApprovalActionsResult {
  approvals: ApprovalUiState[];
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

/**
 * Build a hook that wraps the store's approvals map with a local
 * "awaiting_server" overlay. The injected `send` function is the WS
 * sender owned by `useAgentStream`; passing it through the props
 * boundary keeps this hook component-side without creating a second
 * socket.
 */
export function useApprovalActions(
  runId: string | null,
  send: (frame: ClientFrame) => void,
): UseApprovalActionsResult {
  const approvalsMap = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.approvalsByRequestId ?? null) : null,
  );
  const [awaitingByRequestId, setAwaitingByRequestId] = useState<
    Record<string, true>
  >({});

  const approvals: ApprovalUiState[] = approvalsMap
    ? Object.values(approvalsMap).map((a): ApprovalUiState => {
        if (a.status === "pending" && awaitingByRequestId[a.requestId]) {
          return { ...a, status: "awaiting_server" };
        }
        return a;
      })
    : [];

  const resolve = useCallback(
    (requestId: string, decision: "approve" | "deny", reason?: string) => {
      if (!runId) return;
      // Optimistic local "awaiting_server" overlay — cleared when the
      // outcome arrives (resolved or failed both flip the store status
      // away from "pending", which removes the awaiting key on next
      // render). We also clear on a 10s timeout so a dropped server
      // response doesn't leave the prompt stuck.
      setAwaitingByRequestId((m) => ({ ...m, [requestId]: true }));
      const timeoutId = setTimeout(() => {
        setAwaitingByRequestId((m) => {
          const { [requestId]: _drop, ...rest } = m;
          void _drop;
          return rest;
        });
      }, 10_000);
      // Best-effort: clear once the store reports a non-pending status
      // (subscribe via getState polled at the next macrotask isn't
      // worth a useEffect — the timeout above is the safety net, and
      // the visible state is already correct because the selector
      // re-runs when the outcome lands).
      void timeoutId;

      const csrfToken = useUiStore.getState().csrfToken ?? "";
      void csrfToken; // CSRF rides on the WS upgrade query; not per-frame.

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
