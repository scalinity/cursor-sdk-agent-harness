import { useToolCallProjection } from "../../hooks/useToolCallProjection.js";
import { useRunHealth } from "../../hooks/useRunHealth.js";
import { useRunStore } from "../../state/run-store.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { StreamingSurfaceBoundary } from "./StreamingSurfaceBoundary.js";

export interface ToolCallLaneProps {
  runId: string | null;
}

/**
 * Phase 13 — derive `awaitingApproval` per `call_id`.
 *
 * The harness has no SDK-provided link between a `request.created`
 * event and the tool call it gates, so we use the proximity heuristic:
 * a pending approval is associated with the nearest still-running
 * tool_call at or before the request's seq. If there's no such tool
 * call, the badge is absent (the inline ApprovalPrompt still renders).
 */
function deriveAwaitingApprovalCallIds(
  runId: string | null,
): Set<string> {
  const events = useRunStore.getState().eventsByRunId[runId ?? ""]?.events ?? [];
  const approvals =
    useRunStore.getState().eventsByRunId[runId ?? ""]?.approvalsByRequestId ?? {};
  const out = new Set<string>();
  for (const approval of Object.values(approvals)) {
    if (approval.status !== "pending") continue;
    for (let i = events.length - 1; i >= 0; i--) {
      const evt = events[i];
      if (!evt || evt.seq >= approval.requestSeq) continue;
      if (evt.sdk_type !== "tool_call") continue;
      const p = evt.payload as { call_id?: unknown } | null;
      const cid =
        p && typeof p === "object" && typeof p.call_id === "string"
          ? p.call_id
          : null;
      if (cid) {
        out.add(cid);
        break;
      }
    }
  }
  return out;
}

export function ToolCallLane({ runId }: ToolCallLaneProps) {
  const { calls, groups } = useToolCallProjection(runId);
  const { toolCallHealth } = useRunHealth(runId);
  // Re-derive on every tick by subscribing to the store directly.
  // This is a per-render read; it doesn't subscribe to a slice (the
  // useRunHealth tick already forces a re-render).
  const awaiting = deriveAwaitingApprovalCallIds(runId);

  if (!runId || calls.length === 0) return null;
  const byId = new Map(calls.map((call) => [call.callId, call]));
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
      {groups.map((group) => {
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
