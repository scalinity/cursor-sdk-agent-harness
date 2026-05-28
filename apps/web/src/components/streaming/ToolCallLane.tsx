import { useMemo } from "react";
import { useToolCallProjection } from "../../hooks/useToolCallProjection.js";
import { useRunHealth } from "../../hooks/useRunHealth.js";
import { groupToolCallLanes } from "../../lib/tool-call-projection.js";
import {
  useRunStore,
  type ApprovalState,
} from "../../state/run-store.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { StreamingSurfaceBoundary } from "./StreamingSurfaceBoundary.js";

export interface ToolCallLaneProps {
  runId: string | null;
  /** When set, only these tool calls are rendered in this lane. */
  callIds?: readonly string[] | undefined;
}

/**
 * Phase 13 — derive `awaitingApproval` per `call_id`.
 *
 * The harness has no SDK-provided link between a `request.created`
 * event and the tool call it gates, so we use the proximity
 * heuristic: a pending approval is associated with the nearest
 * still-running tool_call at or before the request's seq. If there's
 * no such tool call, the badge is absent (the inline ApprovalPrompt
 * still renders).
 *
 * RV2-W4: pure function over incremental store projections. Badges refresh
 * when the relevant approval state lands without scanning every canonical
 * event in the run.
 */
function deriveAwaitingApprovalCallIds(
  approvals: Record<string, ApprovalState>,
  approvalToolCallIds: Record<string, string>,
): Set<string> {
  const out = new Set<string>();
  for (const approval of Object.values(approvals)) {
    if (approval.status !== "pending") continue;
    const callId = approvalToolCallIds[approval.requestId];
    if (callId) out.add(callId);
  }
  return out;
}

export function ToolCallLane({ runId, callIds }: ToolCallLaneProps) {
  const { calls, groups } = useToolCallProjection(runId);
  const scopedCalls = useMemo(() => {
    if (!callIds || callIds.length === 0) return calls;
    const allowed = new Set(callIds);
    return callIds
      .map((callId) => calls.find((call) => call.callId === callId))
      .filter((call): call is NonNullable<typeof call> => call !== undefined && allowed.has(call.callId));
  }, [callIds, calls]);
  const scopedGroups = useMemo(
    () => (callIds && callIds.length > 0 ? groupToolCallLanes(scopedCalls) : groups),
    [callIds, groups, scopedCalls],
  );
  const { toolCallHealth } = useRunHealth(runId);
  const approvalsMap = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.approvalsByRequestId ?? null) : null,
  );
  const approvalToolCallIds = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.approvalToolCallIdByRequestId ?? null) : null,
  );
  // RV2-W4: pure useMemo over the slices we just subscribed to.
  // Re-runs only when approvalsByRequestId or the incremental request->tool
  // projection changes, not on every event or useRunHealth tick.
  const awaiting = useMemo(
    () => deriveAwaitingApprovalCallIds(approvalsMap ?? {}, approvalToolCallIds ?? {}),
    [approvalsMap, approvalToolCallIds],
  );

  if (!runId || scopedCalls.length === 0) return null;
  const byId = new Map(scopedCalls.map((call) => [call.callId, call]));
  const cardFor = (callId: string) => {
    const call = byId.get(callId);
    if (!call) return null;
    const health = toolCallHealth[callId];
    return (
      <StreamingSurfaceBoundary key={call.callId} surface={`tool-card-${call.callId}`}>
        <ToolCallCard
          call={call}
          runId={runId}
          awaitingApproval={awaiting.has(call.callId)}
          stillRunning={health?.stillRunning ?? false}
          longRunning={health?.longRunning ?? false}
        />
      </StreamingSurfaceBoundary>
    );
  };

  return (
    <div className="tool-call-stack">
      {scopedGroups.map((group) => {
        if (group.type === "card") {
          return cardFor(group.callId);
        }
        return (
          <div key={group.callIds.join("-")} className="tool-call-lane">
            {group.callIds.map((callId) => cardFor(callId))}
          </div>
        );
      })}
    </div>
  );
}
